import { createContext, useContext } from 'react'

interface UI {
  openProject: (id: string) => void
  openCommand: () => void
}

export const UIContext = createContext<UI>({ openProject: () => {}, openCommand: () => {} })
export const useUI = () => useContext(UIContext)
