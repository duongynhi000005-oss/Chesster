import { useState, useEffect, useRef } from "react";
import { Loader2, Gamepad2, X } from "lucide-react";
import { useToastStore, type Toast as ToastData } from "../store/toastStore";

export const MAX_VISIBLE_TOASTS = 4;
export const DEFAULT_TOAST_DURATION = 5000;
export const INVITATION_TOAST_DURATION = 3000;

const TYPE_STYLES: Record<string, string> = {
	error: "bg-(--error)",
	success: "bg-(--success)",
	loading: "bg-(--warning)",
	info: "bg-(--info)",
	invitation: "bg-gradient-to-r from-purple-600 to-blue-600 border border-purple-400/30",
};

const PROGRESS_BAR_COLORS: Record<string, string> = {
	error: "bg-red-300",
	success: "bg-green-300",
	loading: "bg-yellow-300",
	info: "bg-blue-300",
	invitation: "bg-purple-300",
};

export function ToastItem({
	toast,
	onDismiss,
}: {
	toast: ToastData;
	onDismiss: (id: number) => void;
}) {
	const duration =
		toast.duration ??
		(toast.type === "invitation" ? INVITATION_TOAST_DURATION : DEFAULT_TOAST_DURATION);

	const isAutoDismissible = toast.type !== "loading" && duration > 0 && duration !== Infinity;

	const [progress, setProgress] = useState(100);
	const [isPaused, setIsPaused] = useState(false);

	const remainingMsRef = useRef(duration);

	useEffect(() => {
		remainingMsRef.current = duration;
	}, [duration]);

	useEffect(() => {
		if (!isAutoDismissible) return;

		const tickIntervalMs = 50;

		const timer = setInterval(() => {
			if (!isPaused) {
				remainingMsRef.current -= tickIntervalMs;
				const currentProgress = Math.max(0, (remainingMsRef.current / duration) * 100);
				setProgress(currentProgress);

				if (remainingMsRef.current <= 0) {
					clearInterval(timer);
					onDismiss(toast.id);
				}
			}
		}, tickIntervalMs);

		return () => clearInterval(timer);
	}, [toast.id, duration, isAutoDismissible, isPaused, onDismiss]);

	const progressBarColor = PROGRESS_BAR_COLORS[toast.type] ?? "bg-white/70";

	return (
		<div
			data-testid="toast-item"
			className={`relative overflow-hidden px-4 py-3 rounded-xl shadow-lg text-white flex items-center gap-2 transition-all duration-200 transform translate-y-0 opacity-100 ${
				TYPE_STYLES[toast.type] ?? TYPE_STYLES.info
			} ${toast.type === "loading" ? "cursor-default" : "cursor-pointer"}`}
			onMouseEnter={() => setIsPaused(true)}
			onMouseLeave={() => setIsPaused(false)}
			onClick={() => {
				if (toast.type !== "loading" && toast.type !== "invitation") {
					onDismiss(toast.id);
				}
			}}
		>
			{toast.type === "loading" && (
				<Loader2 size={16} className="animate-spin shrink-0" />
			)}
			{toast.type === "invitation" && (
				<Gamepad2 size={16} className="shrink-0 text-purple-200" />
			)}
			<span className="flex-1 text-sm">{toast.message}</span>
			{toast.type === "invitation" && toast.action && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						toast.action!.onClick();
						onDismiss(toast.id);
					}}
					className="px-2 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-semibold shrink-0 transition-colors"
				>
					{toast.action.label}
				</button>
			)}
			{toast.type !== "loading" && toast.type !== "invitation" && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onDismiss(toast.id);
					}}
					className="text-white/60 hover:text-white transition-colors shrink-0"
					aria-label="Dismiss"
				>
					<X size={14} />
				</button>
			)}

			{isAutoDismissible && (
				<div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-700/50 overflow-hidden rounded-b">
					<div
						data-testid="toast-progress-bar"
						className={`h-full transition-all linear ${progressBarColor}`}
						style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
					/>
				</div>
			)}
		</div>
	);
}

export default function Toast() {
	const { toasts, removeToast } = useToastStore();

	const visibleToasts = toasts.slice(0, MAX_VISIBLE_TOASTS);

	return (
		<div
			data-testid="toast-container"
			className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-xs pointer-events-auto"
		>
			{visibleToasts.map((toast) => (
				<ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
			))}
		</div>
	);
}
