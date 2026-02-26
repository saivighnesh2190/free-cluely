import React, { useState, useEffect, useRef } from "react"
import { useQuery, useQueryClient } from "react-query"
import ScreenshotQueue from "../components/Queue/ScreenshotQueue"
import {
  Toast,
  ToastTitle,
  ToastDescription,
  ToastVariant,
  ToastMessage
} from "../components/ui/toast"
import QueueCommands from "../components/Queue/QueueCommands"
import ModelSelector from "../components/ui/ModelSelector"
import { useAppearance } from "../context/AppearanceContext"
import type { ElectronAPI } from "../types/electron"

interface QueueProps {
  setView: React.Dispatch<React.SetStateAction<"queue" | "solutions" | "debug">>
}

interface ScreenshotItemData {
  path: string
  preview: string
  question?: string
}

interface ChatMessage {
  role: "user" | "gemini"
  text: string
  attachments?: ScreenshotItemData[]
}

const Queue: React.FC<QueueProps> = ({ setView }) => {
  const { appearance } = useAppearance()
  const [toastOpen, setToastOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState<ToastMessage>({
    title: "",
    description: "",
    variant: "neutral"
  })

  const [isTooltipVisible, setIsTooltipVisible] = useState(false)
  const [tooltipHeight, setTooltipHeight] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)

  const [chatInput, setChatInput] = useState("")
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const chatInputRef = useRef<HTMLInputElement>(null)
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [currentModel, setCurrentModel] = useState<{ provider: string; model: string }>({ provider: "gemini", model: "gemini-2.0-flash" })
  const [attachedScreenshots, setAttachedScreenshots] = useState<ScreenshotItemData[]>([])

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const voiceChunksRef = useRef<Blob[]>([])
  const [isVoiceRecording, setIsVoiceRecording] = useState(false)
  const [isVoiceProcessing, setIsVoiceProcessing] = useState(false)
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(null)

  const barRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  const { data: screenshots = [], refetch } = useQuery<ScreenshotItemData[], Error>(
    ["screenshots"],
    async () => {
      try {
        const existing = await window.electronAPI.getScreenshots()
        return existing
      } catch (error) {
        console.error("Error loading screenshots:", error)
        showToast("Error", "Failed to load existing screenshots", "error")
        return []
      }
    },
    {
      staleTime: Infinity,
      cacheTime: Infinity,
      refetchOnWindowFocus: true,
      refetchOnMount: true
    }
  )

  const showToast = (
    title: string,
    description: string,
    variant: ToastVariant
  ) => {
    setToastMessage({ title, description, variant })
    setToastOpen(true)
  }

  const handleDeleteScreenshot = async (index: number) => {
    const screenshotToDelete = screenshots[index]

    try {
      const response = await window.electronAPI.deleteScreenshot(
        screenshotToDelete.path
      )

      if (response.success) {
        refetch()
      } else {
        console.error("Failed to delete screenshot:", response.error)
        showToast("Error", "Failed to delete the screenshot file", "error")
      }
    } catch (error) {
      console.error("Error deleting screenshot:", error)
    }
  }

  const handleChatSend = async () => {
    const trimmedInput = chatInput.trim()
    const attachmentsToSend = [...attachedScreenshots]
    if (!trimmedInput && attachmentsToSend.length === 0) return

    setChatMessages((msgs) => [
      ...msgs,
      {
        role: "user",
        text: trimmedInput,
        attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined
      }
    ])

    setChatLoading(true)
    setChatInput("")

    try {
      if (attachmentsToSend.length > 0) {
        for (const attachment of attachmentsToSend) {
          await analyzeScreenshot(attachment.path, trimmedInput || undefined)
        }
        setAttachedScreenshots((prev) =>
          prev.filter((item) => !attachmentsToSend.some((sent) => sent.path === item.path))
        )
      }

      if (attachmentsToSend.length === 0 && trimmedInput) {
        const response = await window.electronAPI.invoke("gemini-chat", trimmedInput)
        setChatMessages((msgs) => [...msgs, { role: "gemini", text: response }])
      }
    } catch (err) {
      setChatMessages((msgs) => [...msgs, { role: "gemini", text: "Error: " + String(err) }])
    } finally {
      setChatLoading(false)
      chatInputRef.current?.focus()
    }
  }

  // Load current model configuration on mount
  useEffect(() => {
    const loadCurrentModel = async () => {
      try {
        const config = await window.electronAPI.getCurrentLlmConfig();
        setCurrentModel({ provider: config.provider, model: config.model });
      } catch (error) {
        console.error('Error loading current model config:', error);
      }
    };
    loadCurrentModel();
  }, []);

  useEffect(() => {
    const updateDimensions = () => {
      if (contentRef.current) {
        let contentHeight = contentRef.current.scrollHeight
        const contentWidth = contentRef.current.scrollWidth
        if (isTooltipVisible) {
          contentHeight += tooltipHeight
        }
        window.electronAPI.updateContentDimensions({
          width: contentWidth,
          height: contentHeight
        })
      }
    }

    const resizeObserver = new ResizeObserver(updateDimensions)
    if (contentRef.current) {
      resizeObserver.observe(contentRef.current)
    }
    updateDimensions()

    const cleanupFunctions = [
      window.electronAPI.onScreenshotTaken(() => refetch()),
      window.electronAPI.onResetView(() => refetch()),
      window.electronAPI.onSolutionError((error: string) => {
        showToast(
          "Processing Failed",
          "There was an error processing your screenshots.",
          "error"
        )
        setView("queue")
        console.error("Processing error:", error)
      }),
      window.electronAPI.onProcessingNoScreenshots(() => {
        showToast(
          "No Screenshots",
          "There are no screenshots to process.",
          "neutral"
        )
      })
    ]

    return () => {
      resizeObserver.disconnect()
      cleanupFunctions.forEach((cleanup) => cleanup())
    }
  }, [isTooltipVisible, tooltipHeight])

  // Seamless screenshot-to-LLM flow
  useEffect(() => {
    const unsubscribe = window.electronAPI.onScreenshotTaken(async (data) => {
      setAttachedScreenshots((prev) => {
        if (prev.some((item) => item.path === data.path)) {
          return prev
        }
        return [...prev, { path: data.path, preview: data.preview, question: data.question }]
      })
      setIsChatOpen(true)
      chatInputRef.current?.focus()
      await refetch()
    })
    return () => {
      unsubscribe && unsubscribe()
    }
  }, [refetch])

  const escapeHtml = (str: string) =>
    str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;")

  const renderInlineMath = (expression: string, allowExtendedOperators = true) => {
    let result = escapeHtml(expression.trim())

    const symbolReplacements: Array<[RegExp, string]> = [
      [/\\rightarrow/g, "&rarr;"],
      [/\\to/g, "&rarr;"],
      [/\\Rightarrow/g, "&rArr;"],
      [/\\leftarrow/g, "&larr;"],
      [/\\leftrightarrow/g, "&harr;"],
      [/\\geq/g, "&ge;"],
      [/\\leq/g, "&le;"],
      [/\\neq/g, "&ne;"],
      [/\\ne/g, "&ne;"],
      [/\\approx/g, "&asymp;"],
      [/\\sim/g, "&sim;"],
      [/\\times/g, "&times;"],
      [/\\cdot/g, "&middot;"],
      [/\\pm/g, "&plusmn;"],
      [/\\alpha/g, "&alpha;"],
      [/\\beta/g, "&beta;"],
      [/\\gamma/g, "&gamma;"],
      [/\\delta/g, "&delta;"],
      [/\\epsilon/g, "&epsilon;"],
      [/\\lambda/g, "&lambda;"],
      [/\\mu/g, "&mu;"],
      [/\\pi/g, "&pi;"],
      [/\\sigma/g, "&sigma;"],
      [/\\theta/g, "&theta;"],
      [/\\phi/g, "&phi;"],
      [/\\Phi/g, "&Phi;"],
      [/\\psi/g, "&psi;"],
      [/\\Psi/g, "&Psi;"],
      [/\\omega/g, "&omega;"],
      [/\\Omega/g, "&Omega;"],
      [/\\_/g, "_"],
      [/\\text\{([^}]*)\}/g, "$1"],
      [/\\,/g, "&thinsp;"]
    ]

    symbolReplacements.forEach(([pattern, replacement]) => {
      result = result.replace(pattern, replacement)
    })

    result = result
      .replace(/_\{([^}]*)\}/g, "<sub>$1</sub>")
      .replace(/_([a-zA-Z0-9])/g, "<sub>$1</sub>")
      .replace(/\^\{([^}]*)\}/g, "<sup>$1</sup>")
      .replace(/\^([a-zA-Z0-9])/g, "<sup>$1</sup>")

    if (allowExtendedOperators) {
      result = result.replace(/\\xrightarrow\{([^}]*)\}/g, (_, label: string) => {
        const inner = renderInlineMath(label, false)
          .replace(/^<span class="math-inline">/, "")
          .replace(/<\/span>$/, "")
        return `<span class="math-arrow">${inner}&rarr;</span>`
      })

      result = result.replace(/\\xleftarrow\{([^}]*)\}/g, (_, label: string) => {
        const inner = renderInlineMath(label, false)
          .replace(/^<span class="math-inline">/, "")
          .replace(/<\/span>$/, "")
        return `<span class="math-arrow">&larr;${inner}</span>`
      })
    }

    return `<span class="math-inline">${result}</span>`
  }

  const convertTables = (input: string) => {
    const lines = input.split("\n")
    const output: string[] = []
    let tableBuffer: string[] = []

    const isTableSeparator = (line: string) => /\|\s*:?-{3,}:?\s*/.test(line)
    const isTableLine = (line: string) => /^\s*\|.*\|\s*$/.test(line.trim())

    const flushTableBuffer = () => {
      if (tableBuffer.length >= 2 && isTableSeparator(tableBuffer[1])) {
        const headerRow = tableBuffer[0]
        const dataRows = tableBuffer.slice(2)

        const parseRow = (row: string) =>
          row
            .trim()
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((cell) => cell.trim())

        const headerCells = parseRow(headerRow)
        const bodyRows = dataRows
          .filter((row) => row.trim().length > 0)
          .map((row) => parseRow(row))

        const tableHtml = [
          '<div class="chat-table-wrapper" style="overflow-x:auto;margin:0.35rem 0;">',
          '<table class="chat-table" style="width:100%;border-collapse:collapse;font-size:0.78rem;">',
          '<thead><tr>',
          headerCells
            .map(
              (cell) =>
                `<th style="border:1px solid rgba(255,255,255,0.25);padding:0.45rem 0.6rem;text-align:left;background:rgba(255,255,255,0.08);color:#f9fafb;">${cell}</th>`
            )
            .join(""),
          '</tr></thead>',
          '<tbody>',
          bodyRows
            .map(
              (rowCells) =>
                `<tr>${rowCells
                  .map(
                    (cell) =>
                      `<td style="border:1px solid rgba(255,255,255,0.15);padding:0.45rem 0.6rem;color:#f3f4f6;">${cell}</td>`
                  )
                  .join("")}</tr>`
            )
            .join(""),
          '</tbody>',
          '</table>',
          '</div>'
        ].join("")

        output.push(tableHtml)
      } else {
        output.push(...tableBuffer)
      }
      tableBuffer = []
    }

    for (const line of lines) {
      if (isTableLine(line)) {
        tableBuffer.push(line)
      } else {
        flushTableBuffer()
        output.push(line)
      }
    }

    flushTableBuffer()
    return output.join("\n")
  }

  const convertLists = (input: string) => {
    const lines = input.split("\n")
    const output: string[] = []
    let currentList: "ul" | "ol" | null = null

    const closeList = () => {
      if (currentList) {
        output.push(currentList === "ul" ? "</ul>" : "</ol>")
        currentList = null
      }
    }

    for (const line of lines) {
      if (/^\s*[-*+]\s+/.test(line)) {
        if (currentList !== "ul") {
          closeList()
          output.push('<ul class="chat-list">')
          currentList = "ul"
        }
        const item = line.replace(/^\s*[-*+]\s+/, "")
        output.push(`<li>${item}</li>`)
      } else if (/^\s*\d+\.\s+/.test(line)) {
        if (currentList !== "ol") {
          closeList()
          output.push('<ol class="chat-list">')
          currentList = "ol"
        }
        const item = line.replace(/^\s*\d+\.\s+/, "")
        output.push(`<li>${item}</li>`)
      } else {
        closeList()
        output.push(line)
      }
    }

    closeList()
    return output.join("\n")
  }

  const formatMessageToHtml = (text: string) => {
    const codeBlocks: Array<{ lang: string; content: string }> = []
    const mathBlocks: string[] = []
    const inlineMath: string[] = []

    let processed = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang = "", content: string) => {
      const index = codeBlocks.push({ lang: lang.trim() || "text", content }) - 1
      return `@@CODE_BLOCK_${index}@@`
    })

    processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr: string) => {
      const index = mathBlocks.push(expr) - 1
      return `@@MATH_BLOCK_${index}@@`
    })

    processed = processed.replace(/\$(.+?)\$/g, (_, expr: string) => {
      const index = inlineMath.push(expr) - 1
      return `@@INLINE_MATH_${index}@@`
    })

    let html = escapeHtml(processed)

    html = convertTables(html)

    html = html.replace(/^#{3}\s*(.*)$/gm, '<strong class="chat-heading">$1</strong>')
    html = html.replace(/^#{2}\s*(.*)$/gm, '<strong class="chat-heading">$1</strong>')

    html = convertLists(html)

    html = html
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.*?)__/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>')

    html = html
      .replace(/\n{2,}/g, "<br /><br />")
      .replace(/\n/g, "<br />")

    html = html
      .replace(/<ul class="chat-list">\s*<br \/>/g, '<ul class="chat-list">')
      .replace(/<ol class="chat-list">\s*<br \/>/g, '<ol class="chat-list">')
      .replace(/<\/li>\s*<br \/>/g, '</li>')
      .replace(/<\/ul>\s*<br \/>/g, '</ul>')
      .replace(/<\/ol>\s*<br \/>/g, '</ol>')

    html = html.replace(/@@MATH_BLOCK_(\d+)@@/g, (_, idxStr: string) => {
      const expr = mathBlocks[Number(idxStr)] || ""
      const escapedExpr = escapeHtml(expr)
      return `<div class="math-block">${renderInlineMath(escapedExpr)}</div>`
    })

    html = html.replace(/@@CODE_BLOCK_(\d+)@@/g, (_, idxStr: string) => {
      const block = codeBlocks[Number(idxStr)]
      if (!block) return ""
      const escapedContent = escapeHtml(block.content)
      const langAttr = block.lang ? ` data-lang="${block.lang}"` : ""
      return `<pre class="chat-code-block"${langAttr}><code>${escapedContent}</code></pre>`
    })

    html = html.replace(/@@INLINE_MATH_(\d+)@@/g, (_, idxStr: string) => {
      const expr = inlineMath[Number(idxStr)] || ""
      return renderInlineMath(expr)
    })

    html = html
      .replace(/<br \/>\s*(?=<pre class="chat-code-block")/g, "")
      .replace(/(<\/pre>)<br \/>*/g, "$1")
      .replace(/<br \/>\s*(?=<div class="math-block")/g, "")
      .replace(/(<\/div>)<br \/>*/g, "$1")

    return html
  }

  const analyzeScreenshot = async (path: string, question?: string) => {
    setChatLoading(true)
    try {
      const response = await window.electronAPI.analyzeImageFile(path, question)
      setChatMessages((msgs) => [...msgs, { role: "gemini", text: response.text }])
    } catch (error) {
      setChatMessages((msgs) => [...msgs, { role: "gemini", text: "Error: " + String(error) }])
    } finally {
      setChatLoading(false)
    }
  }

  const handleTooltipVisibilityChange = (visible: boolean, height: number) => {
    setIsTooltipVisible(visible)
    setTooltipHeight(height)
  }

  const handleChatToggle = () => {
    setIsChatOpen(!isChatOpen)
  }

  const handleSettingsToggle = () => {
    setIsSettingsOpen(!isSettingsOpen)
  }

  const handleModelChange = (provider: "ollama" | "gemini" | "openrouter", model: string) => {
    setCurrentModel({ provider, model })
    // Update chat messages to reflect the model change
    const modelName = provider === "ollama" ? model : provider === "openrouter" ? model : "Gemini 2.0 Flash"
    const providerIcon = provider === "ollama" ? "🏠" : provider === "openrouter" ? "🌐" : "☁️"
    setChatMessages((msgs) => [...msgs, { 
      role: "gemini", 
      text: `🔄 Switched to ${providerIcon} ${modelName}. Ready for your questions!` 
    }])
  }

  const stopActiveStream = () => {
    const tracks = mediaRecorderRef.current?.stream.getTracks() || []
    tracks.forEach((track) => track.stop())
  }

  const processVoiceRecording = async (blob: Blob) => {
    setIsVoiceProcessing(true)
    if (blob.size === 0) {
      showToast("Audio Error", "No audio captured. Please try again.", "error")
      setIsVoiceProcessing(false)
      return
    }

    try {
      const reader = new FileReader()
      const base64Data = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const result = reader.result as string | null
          if (!result) {
            reject(new Error("Failed to read audio data"))
            return
          }
          const payload = result.split(",")[1]
          if (!payload) {
            reject(new Error("Invalid audio data"))
            return
          }
          resolve(payload)
        }
        reader.onerror = () => reject(reader.error || new Error("Failed to read audio data"))
        reader.readAsDataURL(blob)
      })

      const result: Awaited<ReturnType<ElectronAPI["processVoiceRecording"]>> =
        await window.electronAPI.processVoiceRecording(base64Data, blob.type || "audio/webm")
      setVoiceTranscript(result?.transcript || null)
      if (result?.transcript) {
        queryClient.setQueryData(["audio_result"], {
          text: result.transcript,
          timestamp: Date.now()
        })
      }
      showToast("Audio Captured", "Generating answer from your voice input.", "neutral")
    } catch (error) {
      console.error("Error processing audio:", error)
      showToast("Audio Error", "Failed to analyze audio input.", "error")
    } finally {
      setIsVoiceProcessing(false)
    }
  }

  const handleVoiceRecordToggle = async () => {
    if (isVoiceProcessing) return

    if (isVoiceRecording) {
      mediaRecorderRef.current?.stop()
      setIsVoiceRecording(false)
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      voiceChunksRef.current = []
      setVoiceTranscript(null)

      recorder.ondataavailable = (event) => {
        if (event.data?.size) {
          voiceChunksRef.current.push(event.data)
        }
      }

      recorder.onerror = (event) => {
        console.error("MediaRecorder error:", event)
        showToast("Recording Error", "An error occurred while recording audio.", "error")
        setIsVoiceRecording(false)
        stopActiveStream()
      }

      recorder.onstop = async () => {
        stopActiveStream()
        mediaRecorderRef.current = null
        const combined = new Blob(voiceChunksRef.current, { type: voiceChunksRef.current[0]?.type || "audio/webm" })
        voiceChunksRef.current = []
        await processVoiceRecording(combined)
      }

      recorder.start()
      setIsVoiceRecording(true)
    } catch (error: any) {
      console.error("Microphone access error:", error)
      if (error?.name === "NotAllowedError" || error?.name === "NotFoundError") {
        showToast("Microphone Error", "Microphone access is required to record audio.", "error")
      } else {
        showToast("Microphone Error", "Could not start audio recording.", "error")
      }
      stopActiveStream()
      mediaRecorderRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop()
      }
      stopActiveStream()
    }
  }, [])

  return (
    <div
      ref={barRef}
      style={{
        position: "relative",
        width: "100%",
        pointerEvents: "auto"
      }}
      className="select-none"
    >
      <div className="bg-transparent w-full">
        <div className="px-2 py-1">
          <Toast
            open={toastOpen}
            onOpenChange={setToastOpen}
            variant={toastMessage.variant}
            duration={3000}
          >
            <ToastTitle>{toastMessage.title}</ToastTitle>
            <ToastDescription>{toastMessage.description}</ToastDescription>
          </Toast>
          <div className="w-fit">
            <QueueCommands
              screenshots={screenshots}
              onTooltipVisibilityChange={handleTooltipVisibilityChange}
              onChatToggle={handleChatToggle}
              onSettingsToggle={handleSettingsToggle}
              onVoiceRecordToggle={handleVoiceRecordToggle}
              isRecording={isVoiceRecording}
              isProcessingVoice={isVoiceProcessing}
              voiceTranscript={voiceTranscript}
            />
          </div>
          {/* Conditional Settings Interface */}
          {isSettingsOpen && (
            <div className="mt-4 w-full mx-auto">
              <ModelSelector onModelChange={handleModelChange} onChatOpen={() => setIsChatOpen(true)} />
            </div>
          )}
          
          {/* Conditional Chat Interface */}
          {isChatOpen && (
            <div className="mt-4 w-full mx-auto liquid-glass chat-container p-4 flex flex-col">
              <div className="flex-1 overflow-y-auto mb-3 p-3 rounded-lg bg-white/10 backdrop-blur-md max-h-64 min-h-[120px] glass-content border border-white/20 shadow-lg">
                {chatMessages.length === 0 ? (
                  <div
                    className={`text-sm text-center mt-8 ${
                      appearance === "black" ? "text-gray-200" : "text-gray-600"
                    }`}
                  >
                    💬 Chat with {currentModel.provider === "ollama" ? "🏠" : currentModel.provider === "openrouter" ? "🌐" : "☁️"} {currentModel.model}
                    <br />
                    <span
                      className={`text-xs ${
                        appearance === "black" ? "text-gray-300" : "text-gray-500"
                      }`}
                    >
                      Take a screenshot (Cmd+H) for automatic analysis
                    </span>
                    <br />
                    <span
                      className={`text-xs ${
                        appearance === "black" ? "text-gray-300" : "text-gray-500"
                      }`}
                    >
                      Click ⚙️ Models to switch AI providers
                    </span>
                  </div>
                ) : (
                  chatMessages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`w-full flex ${msg.role === "user" ? "justify-end" : "justify-start"} mb-3`}
                    >
                      <div
                        className={`chat-message-content max-w-[80%] px-3 py-1.5 rounded-xl text-xs shadow-md backdrop-blur-sm border ${
                          msg.role === "user"
                            ? "bg-gray-700/80 text-gray-100 ml-12 border-gray-600/40"
                            : "bg-black/80 text-white mr-12 border-white/30"
                        }`}
                        style={{ wordBreak: "break-word", lineHeight: "1.4" }}
                        dangerouslySetInnerHTML={{ __html: formatMessageToHtml(msg.text) }}
                      />
                    </div>
                  ))
                )}
                {chatLoading && (
                  <div className="flex justify-start mb-3">
                    <div className="bg-black/80 text-white px-3 py-1.5 rounded-xl text-xs backdrop-blur-sm border border-white/30 shadow-md mr-12 whitespace-pre-wrap">
                      <span className="inline-flex items-center">
                        <span className="animate-pulse text-gray-400">●</span>
                        <span className="animate-pulse animation-delay-200 text-gray-400">●</span>
                        <span className="animate-pulse animation-delay-400 text-gray-400">●</span>
                        <span className="ml-2">{currentModel.model} is replying...</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
              {attachedScreenshots.length > 0 && (
                <div className="mb-3 flex gap-3 overflow-x-auto pb-1">
                  {attachedScreenshots.map((shot) => (
                    <div key={shot.path} className="relative flex-shrink-0">
                      <img
                        src={shot.preview}
                        alt="Attached screenshot"
                        className="w-24 h-16 object-cover rounded border border-white/30"
                      />
                      <button
                        type="button"
                        className="absolute -top-1 -right-1 bg-black/70 text-white rounded-full p-0.5 text-[10px]"
                        onClick={() => setAttachedScreenshots((prev) => prev.filter((item) => item.path !== shot.path))}
                        aria-label="Remove attached screenshot"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <form
                className="flex gap-2 items-center glass-content"
                onSubmit={e => {
                  e.preventDefault();
                  handleChatSend();
                }}
              >
                <input
                  ref={chatInputRef}
                  className={`flex-1 rounded-lg px-3 py-2 bg-white/25 backdrop-blur-md text-xs focus:outline-none focus:ring-1 focus:ring-gray-400/60 border border-white/40 shadow-lg transition-all duration-200 ${
                    appearance === "black"
                      ? "text-white placeholder-gray-300"
                      : "text-gray-800 placeholder-gray-500"
                  }`}
                  placeholder="Type your message..."
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  disabled={chatLoading}
                />
                <button
                  type="submit"
                  className="p-2 rounded-lg bg-gray-600/80 hover:bg-gray-700/80 border border-gray-500/60 flex items-center justify-center transition-all duration-200 backdrop-blur-sm shadow-lg disabled:opacity-50"
                  disabled={chatLoading || (!chatInput.trim() && attachedScreenshots.length === 0)}
                  tabIndex={-1}
                  aria-label="Send"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="white" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-7.5-15-7.5v6l10 1.5-10 1.5v6z" />
                  </svg>
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Queue
