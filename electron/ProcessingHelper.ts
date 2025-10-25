import { AppState } from "./main"
import { LLMHelper } from "./LLMHelper"
import dotenv from "dotenv"
import path from "path"
import fs from "fs"

// Load environment variables from .env file
dotenv.config({ path: path.join(process.cwd(), '.env') })

const isDev = process.env.NODE_ENV === "development"
const isDevTest = process.env.IS_DEV_TEST === "true"
const MOCK_API_WAIT_TIME = Number(process.env.MOCK_API_WAIT_TIME) || 500

export class ProcessingHelper {
  private appState: AppState
  private llmHelper: LLMHelper
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  constructor(appState: AppState) {
    this.appState = appState
    
    // Check if user wants to use Ollama
    const useOllama = process.env.USE_OLLAMA === "true"
    const ollamaModel = process.env.OLLAMA_MODEL // Don't set default here, let LLMHelper auto-detect
    const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434"
    
    // Check for OpenRouter API key (prioritize this)
    const openRouterApiKey = process.env.OPENROUTER_API_KEY
    const openRouterModel = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash"
    
    if (useOllama) {
      console.log("[ProcessingHelper] Initializing with Ollama")
      this.llmHelper = new LLMHelper(undefined, true, ollamaModel, ollamaUrl)
    } else if (openRouterApiKey) {
      console.log("[ProcessingHelper] Initializing with OpenRouter")
      this.llmHelper = new LLMHelper(undefined, false, undefined, undefined, true, openRouterApiKey, openRouterModel)
    } else {
      const apiKey = process.env.GEMINI_API_KEY
      if (!apiKey) {
        throw new Error("Neither OPENROUTER_API_KEY nor GEMINI_API_KEY found in environment variables. Set OPENROUTER_API_KEY, GEMINI_API_KEY, or enable Ollama with USE_OLLAMA=true")
      }
      console.log("[ProcessingHelper] Initializing with Gemini")
      this.llmHelper = new LLMHelper(apiKey, false)
    }
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.appState.getMainWindow()
    if (!mainWindow) return

    const view = this.appState.getView()

    if (view === "queue") {
      const screenshotQueue = this.appState.getScreenshotHelper().getScreenshotQueue()
      if (screenshotQueue.length === 0) {
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }

      // Check if last screenshot is an audio file
      const allPaths = this.appState.getScreenshotHelper().getScreenshotQueue();
      const lastPath = allPaths[allPaths.length - 1];
      if (lastPath.endsWith('.mp3') || lastPath.endsWith('.wav')) {
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_START);
        this.appState.setView('solutions');
        try {
          const audioBuffer = await fs.promises.readFile(lastPath)
          const extension = path.extname(lastPath).toLowerCase()
          const mimeType = extension === '.wav' ? 'audio/wav' : 'audio/mpeg'
          await this.processVoiceRecording(audioBuffer.toString('base64'), mimeType)
          return;
        } catch (err: any) {
          console.error('Audio processing error:', err);
          mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, err.message);
          return;
        }
      }

      // NEW: Handle screenshot as plain text (like audio)
      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_START)
      this.appState.setView("solutions")
      this.currentProcessingAbortController = new AbortController()
      try {
        const metadata = this.appState.getScreenshotMetadata(lastPath)
        const imageResult = await this.llmHelper.analyzeImageFile(lastPath, metadata?.question)
        const problemInfo = {
          problem_statement: imageResult.text,
          input_format: { description: "Generated from screenshot", parameters: [] as any[] },
          output_format: { description: "Generated from screenshot", type: "string", subtype: "text" },
          complexity: { time: "N/A", space: "N/A" },
          test_cases: [] as any[],
          validation_type: "manual",
          difficulty: "custom",
          question: metadata?.question || ""
        };
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED, problemInfo);
        this.appState.setProblemInfo(problemInfo);
      } catch (error: any) {
        console.error("Image processing error:", error)
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, error.message)
      } finally {
        this.currentProcessingAbortController = null
      }
      return;
    } else {
      // Debug mode
      const extraScreenshotQueue = this.appState.getScreenshotHelper().getExtraScreenshotQueue()
      if (extraScreenshotQueue.length === 0) {
        console.log("No extra screenshots to process")
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }

      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.DEBUG_START)
      this.currentExtraProcessingAbortController = new AbortController()

      try {
        // Get problem info and current solution
        const problemInfo = this.appState.getProblemInfo()
        if (!problemInfo) {
          throw new Error("No problem info available")
        }

        // Get current solution from state
        const currentSolution = await this.llmHelper.generateSolution(problemInfo)
        const currentCode = currentSolution.solution.code

        // Debug the solution using vision model
        const debugResult = await this.llmHelper.debugSolutionWithImages(
          problemInfo,
          currentCode,
          extraScreenshotQueue
        )

        this.appState.setHasDebugged(true)
        mainWindow.webContents.send(
          this.appState.PROCESSING_EVENTS.DEBUG_SUCCESS,
          debugResult
        )

      } catch (error: any) {
        console.error("Debug processing error:", error)
        mainWindow.webContents.send(
          this.appState.PROCESSING_EVENTS.DEBUG_ERROR,
          error.message
        )
      } finally {
        this.currentExtraProcessingAbortController = null
      }
    }
  }

  public cancelOngoingRequests(): void {
    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
    }

    this.appState.setHasDebugged(false)
  }

  public async processVoiceRecording(data: string, mimeType: string) {
    const mainWindow = this.appState.getMainWindow()
    if (!mainWindow) {
      throw new Error("No main window available")
    }

    mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_START)
    this.appState.setView("solutions")

    try {
      const transcriptResult = await this.llmHelper.analyzeAudioFromBase64(data, mimeType)
      const interpretation = await this.llmHelper.interpretVoiceTranscript(transcriptResult.text)
      const voiceAnswer = await this.llmHelper.generateVoiceResponse(transcriptResult.text, interpretation)

      const problemInfo = {
        problem_statement: interpretation.problem_statement || transcriptResult.text,
        input_format: {
          description: interpretation.context || "Derived from voice input",
          parameters: (interpretation.key_requirements || []).map((requirement: string, index: number) => ({
            name: `requirement_${index + 1}`,
            description: requirement
          }))
        },
        output_format: {
          description:
            interpretation.expected_outcome ||
            "Deliver the outcome requested in the spoken input.",
          type: "string",
          subtype: "voice"
        },
        complexity: {
          time: "N/A",
          space: "N/A"
        },
        test_cases: [] as any[],
        validation_type: "voice",
        difficulty: "custom",
        meta: {
          transcript: transcriptResult.text,
          key_requirements: interpretation.key_requirements || [],
          clarifications_needed: interpretation.clarifications_needed || [],
          reasoning: interpretation.reasoning || "",
          suggested_responses: interpretation.suggested_responses || []
        }
      }

      this.appState.setProblemInfo(problemInfo)
      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED, problemInfo)

      const solutionPayload = {
        solution: {
          code: voiceAnswer,
          thoughts: interpretation.suggested_responses || [],
          time_complexity: "N/A",
          space_complexity: "N/A"
        }
      }

      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.SOLUTION_SUCCESS, solutionPayload)

      return {
        transcript: transcriptResult.text,
        interpretation,
        problemInfo,
        solution: solutionPayload,
        answer: voiceAnswer
      }
    } catch (error: any) {
      console.error("Voice processing error:", error)
      mainWindow.webContents.send(
        this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
        error?.message || String(error)
      )
      throw error
    }
  }

  public async processAudioBase64(data: string, mimeType: string) {
    // Directly use LLMHelper to analyze inline base64 audio
    return this.llmHelper.analyzeAudioFromBase64(data, mimeType);
  }

  // Add audio file processing method
  public async processAudioFile(filePath: string) {
    return this.llmHelper.analyzeAudioFile(filePath);
  }

  public getLLMHelper() {
    return this.llmHelper;
  }
}
