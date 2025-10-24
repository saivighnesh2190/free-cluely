import { GoogleGenAI } from "@google/genai"
import fs from "fs"

interface OllamaResponse {
  response: string
  done: boolean
}

export class LLMHelper {
  private model: GoogleGenAI | null = null
  private readonly systemPrompt = `You are Wingman AI, a helpful, proactive assistant for any kind of problem or situation (not just coding). For any user input, analyze the situation, provide a clear problem statement, relevant context, and suggest several possible responses or actions the user could take next. Always explain your reasoning. Present your suggestions as a list of options or next steps.`
  private useOllama: boolean = false
  private ollamaModel: string = "llama3.2"
  private ollamaUrl: string = "http://localhost:11434"
  private geminiModel: string = "models/gemini-2.5-flash"
  private useOpenRouter: boolean = false
  private geminiApiKey: string = ""
  private openRouterApiKey: string = ""
  private openRouterModel: string = "qwen/qwen3-coder:free"

  constructor(apiKey?: string, useOllama: boolean = false, ollamaModel?: string, ollamaUrl?: string, useOpenRouter: boolean = false, openRouterApiKey?: string, openRouterModel?: string) {
    this.useOllama = useOllama
    this.useOpenRouter = useOpenRouter
    this.geminiApiKey = (apiKey ?? "").trim() || process.env.GEMINI_API_KEY?.trim() || ""
    this.openRouterApiKey = (openRouterApiKey ?? "").trim() || process.env.OPENROUTER_API_KEY?.trim() || this.openRouterApiKey
    if (openRouterModel) {
      this.openRouterModel = openRouterModel
    }

    if (useOpenRouter) {
      console.log(`[LLMHelper] Using OpenRouter with model: ${this.openRouterModel}`)
    } else if (useOllama) {
      this.ollamaUrl = ollamaUrl || "http://localhost:11434"
      this.ollamaModel = ollamaModel || "gemma:latest" // Default fallback
      console.log(`[LLMHelper] Using Ollama with model: ${this.ollamaModel}`)
      
      // Auto-detect and use first available model if specified model doesn't exist
      this.initializeOllamaModel()
    } else if (this.geminiApiKey) {
      this.model = new GoogleGenAI({ apiKey: this.geminiApiKey })
      console.log("[LLMHelper] Using Google Gemini")
    } else {
      throw new Error("Either provide Gemini API key, enable Ollama mode, or provide OpenRouter API key")
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

  private async generateContentWithRetry(contents: any, model?: string): Promise<any> {
    const maxRetries = 3;
    let delay = 1000; // Start with 1 second

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await this.model!.models.generateContent({
          model: model || this.geminiModel,
          contents: contents
        });
        return result;
      } catch (error) {
        if (error.message.includes('503') && attempt < maxRetries - 1) {
          console.log(`[LLMHelper] Model overloaded, retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
        } else {
          throw error;
        }
      }
    }
  }

  private cleanJsonResponse(text: string): string {
    // Remove markdown code block syntax if present
    text = text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '');
    // Remove any leading/trailing whitespace
    text = text.trim();
    return text;
  }

  private async callOllama(prompt: string): Promise<string> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt,
          stream: false,
          options: {
            temperature: 0.7,
            top_p: 0.9
          }
        })
      })

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
      }

      const data: OllamaResponse = await response.json()
      return data.response
    } catch (error: any) {
      console.error("[LLMHelper] Error calling Ollama:", error)
      throw new Error(
        `Failed to connect to Ollama: ${error.message}. Make sure Ollama is running on ${this.ollamaUrl}`
      )
    }
  }

  private async callOpenRouter(prompt: string): Promise<string> {
    if (!this.openRouterApiKey) {
      throw new Error("OpenRouter API key is not configured");
    }

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openRouterApiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://cluely.ai',
          'X-Title': 'Cluely'
        },
        body: JSON.stringify({
          model: this.openRouterModel,
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 4096
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}. ${errorData.error?.message || ''}`)
      }

      const data = await response.json()
      return data.choices[0]?.message?.content || ''
    } catch (error) {
      console.error("[LLMHelper] Error calling OpenRouter:", error)
      throw new Error(`Failed to connect to OpenRouter: ${error.message}`)
    }
  }

  private async checkOllamaAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`)
      return response.ok
    } catch {
      return false
    }
  }

  private async initializeOllamaModel(): Promise<void> {
    try {
      const availableModels = await this.getOllamaModels()
      if (availableModels.length === 0) {
        console.warn("[LLMHelper] No Ollama models found")
        return
      }

      // Check if current model exists, if not use the first available
      if (!availableModels.includes(this.ollamaModel)) {
        this.ollamaModel = availableModels[0]
        console.log(`[LLMHelper] Auto-selected first available model: ${this.ollamaModel}`)
      }

      // Test the selected model works
      const testResult = await this.callOllama("Hello")
      console.log(`[LLMHelper] Successfully initialized with model: ${this.ollamaModel}`)
    } catch (error) {
      console.error(`[LLMHelper] Failed to initialize Ollama model: ${error.message}`)
      // Try to use first available model as fallback
      try {
        const models = await this.getOllamaModels()
        if (models.length > 0) {
          this.ollamaModel = models[0]
          console.log(`[LLMHelper] Fallback to: ${this.ollamaModel}`)
        }
      } catch (fallbackError) {
        console.error(`[LLMHelper] Fallback also failed: ${fallbackError.message}`)
      }
    }
  }

  public async extractProblemFromImages(imagePaths: string[]) {
    try {
      // For OpenRouter, we can't analyze images directly, so we'll provide a text description
      if (this.useOpenRouter) {
        const imageCount = imagePaths.length;
        const prompt = `${this.systemPrompt}\n\nI have ${imageCount} screenshot(s) that I need help analyzing. Since I cannot see the images directly, please provide guidance on what information would be most helpful to extract from coding/problem-solving screenshots, and suggest a general approach for analyzing them.\n\nPlease provide your response in JSON format:\n{
  "problem_statement": "General guidance for analyzing coding screenshots",
  "context": "What to look for in coding screenshots",
  "suggested_responses": ["Approach 1", "Approach 2", "..."],
  "reasoning": "Why this guidance is helpful"
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`
        
        const result = await this.callOpenRouter(prompt);
        const parsed = JSON.parse(result);
        return parsed;
      }

      // Original Gemini implementation for image analysis
      const imageParts = await Promise.all(imagePaths.map(path => this.fileToGenerativePart(path)))
      
      const prompt = `${this.systemPrompt}\n\nYou are a wingman. Please analyze these images and extract the following information in JSON format:\n{
  "problem_statement": "A clear statement of the problem or situation depicted in the images.",
  "context": "Relevant background or context from the images.",
  "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
  "reasoning": "Explanation of why these suggestions are appropriate."
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

      const result = await this.generateContentWithRetry([{ parts: [{ text: prompt }, ...imageParts] }])
      const text = this.cleanJsonResponse(result.candidates[0].content.parts[0].text)
      return JSON.parse(text)
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

    console.log("[LLMHelper] Calling LLM for solution...");
    try {
      let result;
      if (this.useOpenRouter) {
        result = await this.callOpenRouter(prompt);
        console.log("[LLMHelper] OpenRouter LLM returned result.");
      } else {
        result = await this.generateContentWithRetry(prompt);
        console.log("[LLMHelper] Gemini LLM returned result.");
        result = result.candidates[0].content.parts[0].text;
      }
      
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
      // For OpenRouter, we can't analyze debug images directly, so we'll provide guidance
      if (this.useOpenRouter) {
        const imageCount = debugImagePaths.length;
        const prompt = `${this.systemPrompt}\n\nYou are a wingman. Given:\n1. The original problem: ${JSON.stringify(problemInfo, null, 2)}\n2. The current code/solution: ${currentCode}\n3. I have ${imageCount} additional screenshot(s) showing debug/error information\n\nSince I cannot see the debug images directly, please provide general debugging guidance and suggest what information would be most helpful to see in debugging screenshots. Provide your response in this JSON format:\n{
  "solution": {
    "code": "Improved code or debugging suggestions",
    "problem_statement": "Restate the problem",
    "context": "What debugging information would be helpful",
    "suggested_responses": ["Debug step 1", "Debug step 2", "..."],
    "reasoning": "Why these suggestions are appropriate"
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`
        
        const result = await this.callOpenRouter(prompt);
        const parsed = JSON.parse(result);
        console.log("[LLMHelper] Parsed OpenRouter debug response:", parsed);
        return parsed;
      }

      // Original Gemini implementation for image analysis
      const imageParts = await Promise.all(debugImagePaths.map(path => this.fileToGenerativePart(path)))
      
      const prompt = `${this.systemPrompt}\n\nYou are a wingman. Given:\n1. The original problem or situation: ${JSON.stringify(problemInfo, null, 2)}\n2. The current response or approach: ${currentCode}\n3. The debug information in the provided images\n\nPlease analyze the debug information and provide feedback in this JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

      const result = await this.generateContentWithRetry([{ parts: [{ text: prompt }, ...imageParts] }])
      const text = this.cleanJsonResponse(result.candidates[0].content.parts[0].text)
      const parsed = JSON.parse(text)
      console.log("[LLMHelper] Parsed debug LLM response:", parsed)
      return parsed
    } catch (error) {
      console.error("Error debugging solution with images:", error)
      throw error
    }
  }

  public async analyzeAudioFile(audioPath: string) {
    try {
      // For OpenRouter, we can't analyze audio files directly
      if (this.useOpenRouter) {
        const prompt = `${this.systemPrompt}\n\nI have an audio file that I need help analyzing. Since I cannot process audio directly, please provide guidance on how to analyze audio files for problem-solving or coding assistance.\n\nDescribe this audio clip in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next.`;
        
        const result = await this.callOpenRouter(prompt);
        return { text: result, timestamp: Date.now() };
      }

      // Original Gemini implementation for audio analysis
      const audioData = await fs.promises.readFile(audioPath);
      const audioPart = {
        inlineData: {
          data: audioData.toString("base64"),
          mimeType: "audio/mp3"
        }
      };
      const prompt = `${this.systemPrompt}\n\nDescribe this audio clip in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the audio. Do not return a structured JSON object, just answer naturally as you would to a user.`;
      const result = await this.generateContentWithRetry([{ parts: [{ text: prompt }, audioPart] }]);
      const text = result.candidates[0].content.parts[0].text;
      return { text, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing audio file:", error);
      throw error;
    }
  }

  public async analyzeAudioFromBase64(data: string, mimeType: string) {
    try {
      // For OpenRouter, we can't analyze audio data directly
      if (this.useOpenRouter) {
        const prompt = `${this.systemPrompt}\n\nI have audio data that I need help analyzing. Since I cannot process audio directly, please provide guidance on how to analyze audio data for problem-solving or coding assistance.\n\nDescribe this audio clip in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the audio.`;
        
        const result = await this.callOpenRouter(prompt);
        return { text: result, timestamp: Date.now() };
      }

      // Original Gemini implementation for audio analysis
      const audioPart = {
        inlineData: {
          data,
          mimeType
        }
      };
      const prompt = `${this.systemPrompt}\n\nDescribe this audio clip in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the audio. Do not return a structured JSON object, just answer naturally as you would to a user and be concise.`;
      const result = await this.generateContentWithRetry([{ parts: [{ text: prompt }, audioPart] }]);
      const text = result.candidates[0].content.parts[0].text;
      return { text, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing audio from base64:", error);
      throw error;
    }
  }

  public async analyzeImageFile(imagePath: string, userQuestion?: string) {
    try {
      // For OpenRouter, we can't analyze images directly
      if (this.useOpenRouter) {
        const prompt = `${this.systemPrompt}\n\nI have a screenshot that I need help analyzing. Since I cannot see the image directly, please provide guidance on what information would be most helpful to extract from coding/problem-solving screenshots.\n\nAnalyze this screenshot. If there is a question or problem shown in the image, provide a direct answer or solution. If it's just an image without a clear question, describe the content briefly. Always be concise and helpful.`;

        const result = await this.callOpenRouter(prompt);
        return { text: result, timestamp: Date.now() };
      }

      // Original Gemini implementation for image analysis
      const imageData = await fs.promises.readFile(imagePath);
      const imagePart = {
        inlineData: {
          data: imageData.toString("base64"),
          mimeType: "image/png"
        }
      };
      const prompt = `${this.systemPrompt}\n\nAnalyze this screenshot.${userQuestion ? ` The user specifically asked: "${userQuestion}"` : ""} If there is a question or problem shown in the image, provide a direct answer or solution. If it's just an image without a clear question, describe the content briefly. Always be concise and helpful.`;
      const result = await this.generateContentWithRetry([{ parts: [{ text: prompt }, imagePart] }]);
      const text = result.candidates[0].content.parts[0].text;
      return { text, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing image file:", error);
      throw error;
    }
  }

  public async chatWithGemini(message: string): Promise<string> {
    try {
      if (this.useOpenRouter) {
        return this.callOpenRouter(message);
      } else if (this.useOllama) {
        return this.callOllama(message);
      } else if (this.model) {
        const result = await this.generateContentWithRetry(message);
        const text = result.candidates[0].content.parts[0].text;
        return text;
      } else {
        throw new Error("No LLM provider configured");
      }
    } catch (error) {
      console.error("[LLMHelper] Error in chatWithGemini:", error);
      throw error;
    }
  }

  public async chat(message: string): Promise<string> {
    return this.chatWithGemini(message);
  }

  public isUsingOllama(): boolean {
    return this.useOllama;
  }

  public isUsingOpenRouter(): boolean {
    return this.useOpenRouter;
  }

  public async getOllamaModels(): Promise<string[]> {
    if (!this.useOllama) return [];
    
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`);
      if (!response.ok) throw new Error('Failed to fetch models');
      
      const data = await response.json();
      return data.models?.map((model: any) => model.name) || [];
    } catch (error) {
      console.error("[LLMHelper] Error fetching Ollama models:", error);
      return [];
    }
  }

  public getCurrentProvider(): "ollama" | "gemini" | "openrouter" {
    if (this.useOpenRouter) return "openrouter";
    return this.useOllama ? "ollama" : "gemini";
  }

  public getCurrentModel(): string {
    if (this.useOpenRouter) return this.openRouterModel;
    return this.useOllama ? this.ollamaModel : this.geminiModel;
  }

  public async switchToOllama(model?: string, url?: string): Promise<void> {
    this.useOllama = true;
    if (url) this.ollamaUrl = url;
    
    if (model) {
      this.ollamaModel = model;
    } else {
      // Auto-detect first available model
      await this.initializeOllamaModel();
    }
    
    console.log(`[LLMHelper] Switched to Ollama: ${this.ollamaModel} at ${this.ollamaUrl}`);
  }

  public async switchToGemini(apiKey?: string, model?: string): Promise<void> {
    const resolvedKey = (apiKey ?? "").trim() || this.geminiApiKey || process.env.GEMINI_API_KEY?.trim();
    if (!resolvedKey) {
      throw new Error("No Gemini API key provided and no existing model instance");
    }
    
    if (!this.model || apiKey) {
      this.model = new GoogleGenAI({ apiKey: resolvedKey });
    }
    this.geminiApiKey = resolvedKey;
    
    this.useOllama = false;
    this.useOpenRouter = false;
    if (model) {
      this.geminiModel = model;
    }
    console.log("[LLMHelper] Switched to Gemini");
  }

  public async switchToOpenRouter(apiKey: string, model?: string): Promise<void> {
    const resolvedKey = (apiKey ?? "").trim() || this.openRouterApiKey;
    if (!resolvedKey) {
      throw new Error("OpenRouter API key is required");
    }

    this.openRouterApiKey = resolvedKey;
    if (model) {
      this.openRouterModel = model;
    }
    
    this.useOllama = false;
    this.useOpenRouter = true;
    console.log(`[LLMHelper] Switched to OpenRouter: ${this.openRouterModel}`);
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.useOpenRouter) {
        if (!this.openRouterApiKey) {
          return { success: false, error: "No OpenRouter API key configured" };
        }
        // Test with a simple prompt
        await this.callOpenRouter("Hello");
        return { success: true };
      } else if (this.useOllama) {
        const available = await this.checkOllamaAvailable();
        if (!available) {
          return { success: false, error: `Ollama not available at ${this.ollamaUrl}` };
        }
        // Test with a simple prompt
        await this.callOllama("Hello");
        return { success: true };
      } else {
        if (!this.model) {
          return { success: false, error: "No Gemini model configured" };
        }
        // Test with a simple prompt
        const result = await this.generateContentWithRetry("Hello");
        const text = result.candidates[0].content.parts[0].text; // Ensure the response is valid
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