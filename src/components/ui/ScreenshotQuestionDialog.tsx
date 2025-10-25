import React, { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogClose } from "./dialog"
import { X } from "lucide-react"
import { useAppearance } from "../../context/AppearanceContext"

interface ScreenshotQuestionDialogProps {
  screenshot: { path: string; preview: string } | null
  onSubmit: (question: string) => void
  onCancel: () => void
}

const ScreenshotQuestionDialog: React.FC<ScreenshotQuestionDialogProps> = ({
  screenshot,
  onSubmit,
  onCancel
}) => {
  const [question, setQuestion] = useState("")
  const { appearance, setAppearance } = useAppearance()

  useEffect(() => {
    if (screenshot) {
      setQuestion("")
    }
  }, [screenshot?.path])
  const dialogAppearanceClass = appearance === "black"
    ? "bg-black text-white border-white/20"
    : "bg-zinc-900/95 text-white border-white/10"

  const handleSubmit = () => {
    onSubmit(question.trim())
  }

  const handleCancel = () => {
    setQuestion("")
    onCancel()
  }

  return (
    <Dialog open={Boolean(screenshot)} onOpenChange={(open) => {
      if (!open && screenshot) {
        handleCancel()
      }
    }}>
      <DialogContent className={`max-w-md w-full shadow-2xl ${dialogAppearanceClass}`}>
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Add a Question</h2>
              <p className="text-xs text-zinc-300 mt-1">
                Provide additional context or a question to attach to this screenshot before processing.
              </p>
            </div>
            <DialogClose asChild>
              <button
                type="button"
                className="rounded-full p-1 text-zinc-300 hover:text-white hover:bg-white/10"
                aria-label="Close"
                onClick={handleCancel}
              >
                <X className="h-4 w-4" />
              </button>
            </DialogClose>
          </div>

          {screenshot && (
            <div className="rounded-md overflow-hidden border border-white/10">
              <img src={screenshot.preview} alt="Screenshot preview" className="w-full h-auto" />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-wide text-zinc-400">Appearance</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAppearance("transparent")}
                className={`flex-1 rounded-md px-3 py-2 text-sm border transition-colors ${
                  appearance === "transparent"
                    ? "bg-white/15 border-white"
                    : "bg-white/5 border-white/20 hover:bg-white/10"
                }`}
              >
                Transparent
              </button>
              <button
                type="button"
                onClick={() => setAppearance("black")}
                className={`flex-1 rounded-md px-3 py-2 text-sm border transition-colors ${
                  appearance === "black"
                    ? "bg-white text-black"
                    : "bg-white/5 border-white/20 hover:bg-white/10"
                }`}
              >
                Black
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="screenshot-question" className="text-xs uppercase tracking-wide text-zinc-400">
              Question / Context
            </label>
            <textarea
              id="screenshot-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={4}
              className="mt-2 w-full rounded-md bg-zinc-800/80 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-zinc-500"
              placeholder="Describe what you'd like the assistant to focus on..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <button
                type="button"
                onClick={handleCancel}
                className="px-3 py-1.5 rounded-md text-sm bg-transparent border border-white/20 text-zinc-200 hover:bg-white/10"
              >
                Cancel
              </button>
            </DialogClose>
            <button
              type="button"
              onClick={handleSubmit}
              className="px-3 py-1.5 rounded-md text-sm bg-white/80 text-zinc-900 font-medium hover:bg-white"
            >
              Save & Continue
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ScreenshotQuestionDialog
