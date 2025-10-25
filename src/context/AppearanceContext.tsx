import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react"

type AppearanceMode = "transparent" | "black"

interface AppearanceContextValue {
  appearance: AppearanceMode
  setAppearance: (mode: AppearanceMode) => void
  toggleAppearance: () => void
}

const AppearanceContext = createContext<AppearanceContextValue | undefined>(
  undefined
)

const STORAGE_KEY = "app-appearance-mode"

const readStoredAppearance = (): AppearanceMode => {
  if (typeof window === "undefined") return "transparent"

  try {
    const stored = window.localStorage?.getItem(STORAGE_KEY)
    if (stored === "black" || stored === "transparent") {
      return stored
    }
  } catch (error) {
    console.warn("Failed to read stored appearance mode", error)
  }
  return "transparent"
}

export const AppearanceProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const [appearance, setAppearanceState] = useState<AppearanceMode>(
    readStoredAppearance
  )

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.appearance = appearance
    }
  }, [appearance])

  const setAppearance = (mode: AppearanceMode) => {
    setAppearanceState(mode)
    if (typeof window !== "undefined") {
      try {
        window.localStorage?.setItem(STORAGE_KEY, mode)
      } catch (error) {
        console.warn("Failed to persist appearance mode", error)
      }
    }
  }

  const value = useMemo(
    () => ({
      appearance,
      setAppearance,
      toggleAppearance: () => setAppearance(appearance === "black" ? "transparent" : "black")
    }),
    [appearance]
  )

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  )
}

export const useAppearance = (): AppearanceContextValue => {
  const ctx = useContext(AppearanceContext)
  if (!ctx) {
    throw new Error("useAppearance must be used within AppearanceProvider")
  }
  return ctx
}
