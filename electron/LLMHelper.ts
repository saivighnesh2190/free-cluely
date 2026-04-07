import { GoogleGenAI } from "@google/genai"
import fs from "fs"
import Tesseract from "tesseract.js"


export class LLMHelper {
  private model: GoogleGenAI | null = null
  private readonly systemPrompt = `You are Wingman AI, a helpful, proactive assistant for any kind of problem or situation. 

CRITICAL: You MUST use Markdown for all responses.
1. Use headers (#, ##), lists (* or 1.), and bold text to organize information clearly.
2. Use LaTeX for ALL mathematical formulas and equations. 
   - Use double dollar signs for block equations: $$x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}$$
   - Use single dollar signs for inline math: $E=mc^2$
   - ONLY use $ and $$ as delimiters. NEVER use \\(...\\) or \\[...\\].
   - If using math inside a Markdown table, avoid using the pipe character | (for absolute values, etc.) as it breaks the table. Use \\vert or \\mid instead.
3. Use code blocks with language specification for any code snippets.
4. For any user input, analyze the situation, provide a clear problem statement, relevant context, and suggest several possible responses or actions the user could take next. 
5. Always explain your reasoning.`
  private geminiModel: string = "models/gemini-3-flash-preview"
  private useK2Think: boolean = false
  private geminiApiKey: string = ""
  private fallbackGeminiApiKey: string = ""
  private usingFallbackKey: boolean = false
  private k2ThinkApiKey: string = ""
  private k2ThinkModel: string = "MBZUAI-IFM/K2-Think-v2"


  constructor(apiKey?: string) {
    this.useK2Think = process.env.USE_K2_THINK === "true"
    this.geminiApiKey = (apiKey ?? "").trim() || process.env.GEMINI_API_KEY?.trim() || ""
    this.fallbackGeminiApiKey = process.env.GEMINI_FALLBACK_API_KEY?.trim() || ""
    this.k2ThinkApiKey = process.env.K2_THINK_API_KEY?.trim() || ""

    // Safety: If no primary key is found but a fallback key exists, use it
    if (!this.geminiApiKey && this.fallbackGeminiApiKey) {
      console.log("[LLMHelper] No primary API key found, using fallback key as primary.");
      this.geminiApiKey = this.fallbackGeminiApiKey;
      this.usingFallbackKey = true;
    }

    if (this.useK2Think) {
      console.log(`[LLMHelper] Using K2 Think V2 with model: ${this.k2ThinkModel}`)
      // Also initialize Gemini as fallback if key is available
      if (this.geminiApiKey) {
        this.model = new GoogleGenAI({ apiKey: this.geminiApiKey })
        console.log("[LLMHelper] Gemini initialized as fallback provider")
      }
    } else if (this.geminiApiKey) {
      this.model = new GoogleGenAI({ apiKey: this.geminiApiKey })
      console.log("[LLMHelper] Using Google Gemini")
    } else if (!this.k2ThinkApiKey) {
      throw new Error("Either provide Gemini API key or enable K2 Think")
    }
  }

  private async fileToGenerativePart(imagePath: string) {
    const imageData = await fs.promises.readFile(imagePath)
    return {
      inlineData: {
        data: imageData.toString("base64"),
        mimeType: "image/png"
      }
    }
  }

  private resolveGeminiApiKey(): string {
    if (this.geminiApiKey) return this.geminiApiKey
    const envKey = process.env.GEMINI_API_KEY?.trim()
    if (envKey) {
      this.geminiApiKey = envKey
    }
    return this.geminiApiKey
  }

  private async getGeminiClient(): Promise<GoogleGenAI> {
    const apiKey = this.resolveGeminiApiKey()
    if (!apiKey) {
      throw new Error("Gemini API key is required")
    }

    if (!this.model) {
      this.model = new GoogleGenAI({ apiKey })
    }
    return this.model
  }

  private async generateContentWithRetry(contents: any, model?: string, client?: GoogleGenAI): Promise<any> {
    const targetClient = client ?? this.model
    if (!targetClient) {
      throw new Error("No LLM client configured")
    }

    try {
      const result = await targetClient.models.generateContent({
        model: model || this.geminiModel,
        contents: contents
      });
      return result;
    } catch (error: any) {
      const errorMessage = error.message || '';
      // For 503 overloaded, retry once with delay
      if (errorMessage.includes('503')) {
        console.log(`[LLMHelper] Model overloaded, retrying in 2s...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return targetClient.models.generateContent({
          model: model || this.geminiModel,
          contents: contents
        });
      }
      throw error;
    }
  }

  /**
   * 5-Tier Fallback Chain for text-only prompts:
   * 1. Gemini 3 Flash (Primary Key)
   * 2. Gemini 2.5 Flash (Primary Key) — separate model quota
   * 3. K2 Think V2 — completely different provider
   * 4. Gemini 3 Flash (Fallback Key) — fresh project quota
   * 5. Gemini 2.5 Flash (Fallback Key) — absolute last resort
   */
  private async callTextWithFallback(prompt: string): Promise<string> {
    const errors: string[] = [];

    // Build fallback chain
    const chain: { name: string; call: () => Promise<string> }[] = [];

    // Determine primary model order based on user's selected provider
    const primaryModel = this.geminiModel; // e.g. "models/gemini-3-flash-preview"
    const secondaryModel = primaryModel.includes("3-flash")
      ? "models/gemini-2.5-flash"
      : "models/gemini-3-flash-preview";

    // Tier 1: Primary model with primary key
    if (this.geminiApiKey) {
      chain.push({
        name: `${primaryModel} (primary key)`,
        call: async () => {
          const client = new GoogleGenAI({ apiKey: this.geminiApiKey });
          const result = await this.generateContentWithRetry(prompt, primaryModel, client);
          return result.candidates[0].content.parts[0].text;
        }
      });
    }

    // Tier 2: Secondary Gemini model with primary key (separate quota!)
    if (this.geminiApiKey) {
      chain.push({
        name: `${secondaryModel} (primary key)`,
        call: async () => {
          const client = new GoogleGenAI({ apiKey: this.geminiApiKey });
          const result = await this.generateContentWithRetry(prompt, secondaryModel, client);
          return result.candidates[0].content.parts[0].text;
        }
      });
    }

    // Tier 3: K2 Think — completely different provider
    if (this.k2ThinkApiKey) {
      chain.push({
        name: "K2 Think V2",
        call: async () => this.callK2Think(prompt)
      });
    }

    // Tier 4: Primary model with fallback key
    if (this.fallbackGeminiApiKey && this.fallbackGeminiApiKey !== this.geminiApiKey) {
      chain.push({
        name: `${primaryModel} (fallback key)`,
        call: async () => {
          const client = new GoogleGenAI({ apiKey: this.fallbackGeminiApiKey });
          const result = await this.generateContentWithRetry(prompt, primaryModel, client);
          return result.candidates[0].content.parts[0].text;
        }
      });
    }

    // Tier 5: Secondary model with fallback key
    if (this.fallbackGeminiApiKey && this.fallbackGeminiApiKey !== this.geminiApiKey) {
      chain.push({
        name: `${secondaryModel} (fallback key)`,
        call: async () => {
          const client = new GoogleGenAI({ apiKey: this.fallbackGeminiApiKey });
          const result = await this.generateContentWithRetry(prompt, secondaryModel, client);
          return result.candidates[0].content.parts[0].text;
        }
      });
    }

    // Execute chain
    for (let i = 0; i < chain.length; i++) {
      const tier = chain[i];
      try {
        console.log(`[LLMHelper] Trying Tier ${i + 1}/${chain.length}: ${tier.name}`);
        const result = await tier.call();
        if (i > 0) console.log(`[LLMHelper] ✅ Tier ${i + 1} succeeded after ${i} failure(s)`);
        return result;
      } catch (error: any) {
        const msg = error.message || String(error);
        errors.push(`Tier ${i + 1} (${tier.name}): ${msg}`);
        console.warn(`[LLMHelper] ❌ Tier ${i + 1} failed: ${msg}`);
      }
    }

    throw new Error(`All ${chain.length} providers failed:\n${errors.join('\n')}`);
  }

  /**
   * 5-Tier Fallback Chain for image-based prompts (Gemini gets images, K2 Think gets OCR text)
   */
  private async callImageWithFallback(promptText: string, imagePaths: string[]): Promise<string> {
    const errors: string[] = [];

    // Prepare image data for Gemini
    const imageParts = await Promise.all(imagePaths.map(path => this.fileToGenerativePart(path)));
    const geminiContents = [{ parts: [{ text: promptText }, ...imageParts] }];

    // Build fallback chain
    const chain: { name: string; call: () => Promise<string> }[] = [];

    const primaryModel = this.geminiModel;
    const secondaryModel = primaryModel.includes("3-flash")
      ? "models/gemini-2.5-flash"
      : "models/gemini-3-flash-preview";

    // Tier 1: Primary model with primary key (direct image)
    if (this.geminiApiKey) {
      chain.push({
        name: `${primaryModel} (primary key)`,
        call: async () => {
          const client = new GoogleGenAI({ apiKey: this.geminiApiKey });
          const result = await this.generateContentWithRetry(geminiContents, primaryModel, client);
          return result.candidates[0].content.parts[0].text;
        }
      });
    }

    // Tier 2: Secondary Gemini model 
    if (this.geminiApiKey) {
      chain.push({
        name: `${secondaryModel} (primary key)`,
        call: async () => {
          const client = new GoogleGenAI({ apiKey: this.geminiApiKey });
          const result = await this.generateContentWithRetry(geminiContents, secondaryModel, client);
          return result.candidates[0].content.parts[0].text;
        }
      });
    }

    // Tier 3: K2 Think with OCR
    if (this.k2ThinkApiKey) {
      chain.push({
        name: "K2 Think V2 (with OCR)",
        call: async () => {
          const ocrResults = await Promise.all(imagePaths.map(path => Tesseract.recognize(path, 'eng')));
          const extractedText = ocrResults.map(r => r.data.text).join("\n---\n");
          const ocrPrompt = `${promptText}\n\nCONTEXT FROM SCREENSHOTS (EXTRACTED VIA LOCAL OCR):\n"""\n${extractedText}\n"""`;
          return this.callK2Think(ocrPrompt);
        }
      });
    }

    // Tier 4 & 5: Fallback key models
    if (this.fallbackGeminiApiKey && this.fallbackGeminiApiKey !== this.geminiApiKey) {
      chain.push({
        name: `${primaryModel} (fallback key)`,
        call: async () => {
          const client = new GoogleGenAI({ apiKey: this.fallbackGeminiApiKey });
          const result = await this.generateContentWithRetry(geminiContents, primaryModel, client);
          return result.candidates[0].content.parts[0].text;
        }
      });
      chain.push({
        name: `${secondaryModel} (fallback key)`,
        call: async () => {
          const client = new GoogleGenAI({ apiKey: this.fallbackGeminiApiKey });
          const result = await this.generateContentWithRetry(geminiContents, secondaryModel, client);
          return result.candidates[0].content.parts[0].text;
        }
      });
    }

    // Execute chain
    for (let i = 0; i < chain.length; i++) {
      const tier = chain[i];
      try {
        console.log(`[LLMHelper] Trying Tier ${i + 1}/${chain.length}: ${tier.name}`);
        const result = await tier.call();
        if (i > 0) console.log(`[LLMHelper] ✅ Tier ${i + 1} succeeded after ${i} failure(s)`);
        return result;
      } catch (error: any) {
        const msg = error.message || String(error);
        errors.push(`Tier ${i + 1} (${tier.name}): ${msg}`);
        console.warn(`[LLMHelper] ❌ Tier ${i + 1} failed: ${msg}`);
      }
    }

    throw new Error(`All ${chain.length} providers failed:\n${errors.join('\n')}`);
  }


  private cleanJsonResponse(text: string): string {
    // Remove markdown code block syntax if present
    text = text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '');
    // Remove any leading/trailing whitespace
    text = text.trim();
    return text;
  }

  public async interpretVoiceTranscript(transcript: string) {
    const trimmed = transcript?.trim();
    if (!trimmed) {
      throw new Error("Empty voice transcript provided");
    }

    const prompt = `${this.systemPrompt}\n\nThe user spoke the following text:\n"""${trimmed}"""\n\nInterpret the request, infer what the user is asking for and what outcome they expect. Respond ONLY with a JSON object using this exact schema:\n{\n  "problem_statement": "Concise restatement of the user's request",\n  "context": "Relevant background or assumptions to understand the request",\n  "expected_outcome": "What result or deliverable the user wants",\n  "key_requirements": ["Bullet list of must-have requirements or constraints"],\n  "clarifications_needed": ["Questions we should ask if anything is ambiguous"],\n  "suggested_responses": ["High-level actions or solution directions"],\n  "reasoning": "Short explanation describing how you interpreted the request"\n}\nDo not include markdown code fences or any additional narration.`;

    try {
      const geminiClient = await this.getGeminiClient();
      const result = await this.generateContentWithRetry([{ parts: [{ text: prompt }] }], this.geminiModel, geminiClient);
      const text = this.cleanJsonResponse(result.candidates[0].content.parts[0].text);
      return JSON.parse(text);
    } catch (error: any) {
      console.error("Error interpreting voice transcript:", error);
      throw new Error(error?.message || "Failed to interpret voice request");
    }
  }

  public async generateVoiceResponse(transcript: string, interpretation?: any): Promise<string> {
    const geminiClient = await this.getGeminiClient()
    const reasoning = interpretation?.reasoning ? `\nReasoning provided: ${interpretation.reasoning}` : ""
    const outcome = interpretation?.expected_outcome ? `\nExpected outcome: ${interpretation.expected_outcome}` : ""
    const requirements = Array.isArray(interpretation?.key_requirements) && interpretation.key_requirements.length
      ? `\nKey requirements: ${interpretation.key_requirements.join("; ")}`
      : ""

    const prompt = `You are Wingman AI responding to a voice request. The transcript is:\n"""${transcript.trim()}"""${outcome}${requirements}${reasoning}\n\nProvide a direct, helpful answer to the user's request. Focus on delivering the explanation or result they asked for. Keep the tone concise, practical, and on-topic. If the request is to explain or describe something, give a thorough yet approachable explanation. Avoid offering meta-comments about needing clarification unless the transcript is ambiguous beyond interpretation.`

    const result = await this.generateContentWithRetry([{ parts: [{ text: prompt }] }], this.geminiModel, geminiClient)
    const text = result.candidates[0].content.parts[0].text?.trim()
    if (!text) {
      throw new Error("Voice response generation returned empty output")
    }
    return text
  }



  private async callK2Think(prompt: string): Promise<string> {
    if (!this.k2ThinkApiKey) {
      throw new Error("K2 Think API key is not configured");
    }

    try {
      const response = await fetch("https://api.k2think.ai/v1/chat/completions", {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.k2ThinkApiKey}`,
          'accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.k2ThinkModel,
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
          stream: false
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(`K2 Think API error: ${response.status} ${response.statusText}. ${errorData.message || ''}`)
      }

      const data = await response.json()
      return data.choices[0]?.message?.content || ''
    } catch (error: any) {
      console.error("[LLMHelper] Error calling K2 Think:", error)
      throw new Error(`Failed to connect to K2 Think: ${error.message}`)
    }
  }



  public async extractProblemFromImages(imagePaths: string[]) {
    try {
      const prompt = `${this.systemPrompt}\n\nYou are a wingman. Please analyze these images and extract the following information in JSON format:\n{
  "problem_statement": "A clear statement of the problem or situation depicted in the images.",
  "context": "Relevant background or context from the images.",
  "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
  "reasoning": "Explanation of why these suggestions are appropriate."
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

      const result = await this.callImageWithFallback(prompt, imagePaths);
      return JSON.parse(this.cleanJsonResponse(result));
    } catch (error) {
      console.error("Error extracting problem from images:", error)
      throw error
    }
  }

  public async generateSolution(problemInfo: any) {
    const prompt = `${this.systemPrompt}\n\nGiven this problem or situation:\n${JSON.stringify(problemInfo, null, 2)}\n\nPlease provide your response in the following JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

    console.log("[LLMHelper] Calling LLM for solution (5-tier fallback chain)...");
    try {
      const result = await this.callTextWithFallback(prompt);
      const text = this.cleanJsonResponse(result);
      const parsed = JSON.parse(text);
      console.log("[LLMHelper] Parsed LLM response:", parsed);
      return parsed;
    } catch (error) {
      console.error("[LLMHelper] Error in generateSolution:", error);
      throw error;
    }
  }

  public async debugSolutionWithImages(problemInfo: any, currentCode: string, debugImagePaths: string[]) {
    try {
      const prompt = `${this.systemPrompt}\n\nYou are a wingman. Given:\n1. The original problem or situation: ${JSON.stringify(problemInfo, null, 2)}\n2. The current response or approach: ${currentCode}\n3. The debug information in the provided images\n\nPlease analyze the debug information and provide feedback in this JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

      const result = await this.callImageWithFallback(prompt, debugImagePaths);
      const parsed = JSON.parse(this.cleanJsonResponse(result));
      console.log("[LLMHelper] Parsed debug LLM response:", parsed);
      return parsed;
    } catch (error) {
      console.error("Error debugging solution with images:", error)
      throw error
    }
  }

  public async analyzeAudioFile(audioPath: string) {
    try {
      const client = await this.getGeminiClient()
      const audioData = await fs.promises.readFile(audioPath);
      const audioPart = {
        inlineData: {
          data: audioData.toString("base64"),
          mimeType: "audio/mp3"
        }
      };
      const prompt = `${this.systemPrompt}\n\nDescribe this audio clip in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the audio. Do not return a structured JSON object, just answer naturally as you would to a user.`;
      const result = await this.generateContentWithRetry([{ parts: [{ text: prompt }, audioPart] }], this.geminiModel, client);
      const text = result.candidates[0].content.parts[0].text;
      return { text, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing audio file:", error);
      throw error;
    }
  }

  public async analyzeAudioFromBase64(data: string, mimeType: string) {
    try {
      const client = await this.getGeminiClient()
      const audioPart = {
        inlineData: {
          data,
          mimeType
        }
      };
      const prompt = `${this.systemPrompt}\n\nDescribe this audio clip in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the audio. Do not return a structured JSON object, just answer naturally as you would to a user and be concise.`;
      const result = await this.generateContentWithRetry([{ parts: [{ text: prompt }, audioPart] }], this.geminiModel, client);
      const text = result.candidates[0].content.parts[0].text;
      return { text, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing audio from base64:", error);
      throw error;
    }
  }

  public async analyzeImageFile(imagePath: string, userQuestion?: string) {
    try {
      const versatilePrompt = `Analyze this screenshot carefully and identify what type of content it contains, then answer accordingly:

1. If it is a CODING/PROGRAMMING question (problem statement): First, detect the programming language from the screenshot (look for language indicators, syntax, or code editor hints). If a specific language is visible (e.g., C++, Python, C, JavaScript, etc.), provide the solution in THAT language only. If no language is specified or detected, default to Java. Provide TWO solutions - a BRUTE FORCE approach and an OPTIMIZED approach. Include Time and Space complexity as comments. Check test cases and constraints carefully.

2. If it is a CODE SNIPPET (that needs debugging): Fix the bug by modifying the code MINIMALLY. Check if there is a "Debug Constraint" (e.g., max X characters modified) mentioned in the screenshot and adherent strictly to it. Provide the corrected code and briefly mention which lines were changed.

3. If it is an APTITUDE/REASONING question (math, logical reasoning, puzzles, quantitative): Provide the correct answer with a clear step-by-step solution. Show the formula or method used.

4. If it is a THEORETICAL/CONCEPTUAL question (definitions, concepts, explanations): Give a clear, concise, and accurate answer. Use bullet points if needed.

5. If it is a TECHNICAL INTERVIEW question (system design, OS, DBMS, networking, OOP concepts): Provide a well-structured answer with key points, examples, and any relevant diagrams described in text.

6. If it is a MULTIPLE CHOICE question (MCQ): Identify the correct option and explain why it is correct and why other options are wrong.

Detect the content type automatically from the screenshot and respond with the most appropriate format. Be accurate, concise, and direct.${userQuestion ? ` The user specifically asked: "${userQuestion}"` : ""}`;

      const result = await this.callImageWithFallback(versatilePrompt, [imagePath]);
      return { text: result, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing image file:", error);
      throw error;
    }
  }

  public async chatWithGemini(message: string): Promise<string> {
    try {
      return await this.callTextWithFallback(message);
    } catch (error) {
      console.error("[LLMHelper] Error in chatWithGemini:", error);
      throw error;
    }
  }

  public async chat(message: string): Promise<string> {
    return this.chatWithGemini(message);
  }



  public getCurrentProvider(): "gemini" | "k2think" {
    return this.useK2Think ? "k2think" : "gemini";
  }

  public getCurrentModel(): string {
    return this.useK2Think ? this.k2ThinkModel : this.geminiModel;
  }

  public async switchToGemini(apiKey?: string, model?: string): Promise<void> {
    const resolvedKey = (apiKey ?? "").trim() || this.geminiApiKey || process.env.GEMINI_API_KEY?.trim();
    if (!resolvedKey) {
      throw new Error("No Gemini API key provided and no existing model instance");
    }

    this.model = new GoogleGenAI({ apiKey: resolvedKey });
    this.geminiApiKey = resolvedKey;
    this.useK2Think = false;

    if (model) {
      this.geminiModel = model;
    }
    console.log(`[LLMHelper] Switched to Gemini (useK2Think=${this.useK2Think}, model=${this.geminiModel})`);
  }

  public async switchToK2Think(apiKey?: string, model?: string): Promise<void> {
    const resolvedKey = (apiKey ?? "").trim() || this.k2ThinkApiKey;
    if (!resolvedKey) {
      throw new Error("K2 Think API key is required");
    }

    this.k2ThinkApiKey = resolvedKey;
    if (model) {
      this.k2ThinkModel = model;
    }

    this.useK2Think = true;
    console.log(`[LLMHelper] Switched to K2 Think V2: ${this.k2ThinkModel}`);
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.useK2Think) {
        if (!this.k2ThinkApiKey) {
          return { success: false, error: "No K2 Think API key configured" };
        }
        await this.callK2Think("Hello");
        return { success: true };
      } else {
        if (!this.model) {
          return { success: false, error: "No Gemini model configured" };
        }
        const result = await this.generateContentWithRetry("Hello");
        const text = result.candidates[0].content.parts[0].text;
        if (text) {
          return { success: true };
        } else {
          return { success: false, error: "Empty response from Gemini" };
        }
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
} 