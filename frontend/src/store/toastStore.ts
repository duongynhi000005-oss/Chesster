import { create } from 'zustand';

export type ToastType = 'error' | 'success' | 'info' | 'loading' | 'invitation';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
  duration?: number;
  /** Optional action label + callback (used by invitation toasts). */
  action?: { label: string; onClick: () => void };
}

interface ToastStore {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType, action?: Toast['action'], duration?: number) => number;
  removeToast: (id: number) => void;
  clearToasts: () => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (message, type = 'error', action, duration) => {
    const id = Date.now() + Math.random();
    set((state) => ({
      toasts: [...state.toasts, { id, message, type, action, duration }],
    }));
    return id;
  },

  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  clearToasts: () => set({ toasts: [] }),
}));
