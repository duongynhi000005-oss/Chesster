import { create } from 'zustand';

export type ToastType = 'error' | 'success' | 'info' | 'loading' | 'invitation';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
  /** Optional action label + callback (used by invitation toasts). */
  action?: { label: string; onClick: () => void };
  /** Duration in milliseconds before auto-dismissal (default 5000ms, or 3000ms for invitation). */
  duration?: number;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType, action?: Toast['action'], duration?: number) => number;
  removeToast: (id: number) => void;
  clearToasts: () => void;
}

let nextToastId = 1;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (message, type = 'error', action, duration) => {
    const id = Date.now() + nextToastId++;
    set((state) => ({ toasts: [...state.toasts, { id, message, type, action, duration }] }));
    return id;
  },

  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  clearToasts: () => set({ toasts: [] })
}));
