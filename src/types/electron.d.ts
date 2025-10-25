export interface ElectronAPI {
  updateContentDimensions: (dimensions: { width: number; height: number }) => Promise<void>
  getScreenshots: () => Promise<Array<{ path: string; preview: string; question?: string }>>
  deleteScreenshot: (path: string) => Promise<{ success: boolean; error?: string }>

  onScreenshotTaken: (callback: (data: { path: string; preview: string; question?: string }) => void) => () => void
  onScreenshotError: (callback: (data: { message: string; details: string }) => void) => () => void
  onSolutionsReady: (callback: (solutions: string) => void) => () => void
  onResetView: (callback: () => void) => () => void
  onSolutionStart: (callback: () => void) => () => void
  onDebugStart: (callback: () => void) => () => void
  onDebugSuccess: (callback: (data: any) => void) => () => void
  onSolutionError: (callback: (error: string) => void) => () => void
  onProcessingNoScreenshots: (callback: () => void) => () => void
  onProblemExtracted: (callback: (data: any) => void) => () => void
  onSolutionSuccess: (callback: (data: any) => void) => () => void
  onUnauthorized: (callback: () => void) => () => void
  onDebugError: (callback: (error: string) => void) => () => void

  takeScreenshot: () => Promise<void>
  moveWindowLeft: () => Promise<void>
  moveWindowRight: () => Promise<void>
  moveWindowUp: () => Promise<void>
  moveWindowDown: () => Promise<void>

  analyzeAudioFromBase64: (data: string, mimeType: string) => Promise<{ text: string; timestamp: number }>
  analyzeAudioFile: (path: string) => Promise<{ text: string; timestamp: number }>
  analyzeImageFile: (path: string, question?: string) => Promise<{ text: string; timestamp: number }>
  processVoiceRecording: (data: string, mimeType: string) => Promise<{ transcript: string; interpretation: any; problemInfo: any; solution: any }>
  setScreenshotQuestion: (path: string, question: string) => Promise<{ success: boolean; error?: string }>
  quitApp: () => Promise<void>

  // LLM Model Management
  getCurrentLlmConfig: () => Promise<{ provider: "ollama" | "gemini" | "openrouter"; model: string; isOllama: boolean; isOpenRouter: boolean }>
  getAvailableOllamaModels: () => Promise<string[]>
  switchToOllama: (model?: string, url?: string) => Promise<{ success: boolean; error?: string }>
  switchToGemini: (apiKey?: string, model?: string) => Promise<{ success: boolean; error?: string }>
  switchToOpenRouter: (apiKey: string, model?: string) => Promise<{ success: boolean; error?: string }>
  testLlmConnection: () => Promise<{ success: boolean; error?: string }>

  invoke: (channel: string, ...args: any[]) => Promise<any>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}