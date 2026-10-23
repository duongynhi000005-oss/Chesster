import { useState, useEffect, useRef } from "react";
import { Loader2, Gamepad2, X } from "lucide-react";
import { useToastStore, type Toast as ToastItemType } from "../store/toastStore";

const TYPE_STYLES: Record<string, string> = {
	error: "bg-(--error)",
	success: "bg-(--success)",
	loading: "bg-(--warning)",
	info: "bg-(--info)",
	invitation: "bg-gradient-to-r from-purple-600 to-blue-600 border border-purple-400/30",
};

const PROGRESS_BAR_COLORS: Record<string, string> = {
	error: "bg-red-200/80",
	success: "bg-emerald-200/80",
	loading: "bg-amber-200/80",
	info: "bg-blue-200/80",
	invitation: "bg-purple-200/80",
};

export const MAX_VISIBLE_TOASTS = 4;
export const DEFAULT_TOAST_DURATION = 5000;
export const INVITATION_TOAST_DURATION = 3000;

interface ToastItemProps {
	toast: ToastItemType;
	onDismiss: (id: number) => void;
}

export function ToastItem({ toast, onDismiss }: ToastItemProps) {
	const [isPaused, setIsPaused] = useState(false);
	const duration =
		toast.duration ??
		(toast.type === "invitation" ? INVITATION_TOAST_DURATION : DEFAULT_TOAST_DURATION);
	const isAutoDismiss = toast.type !== "loading" && duration > 0 && duration !== Infinity;
	const [remainingTime, setRemainingTime] = useState(duration);

	const isPausedRef = useRef(isPaused);

	useEffect(() => {
		isPausedRef.current = isPaused;
	}, [isPaused]);

	useEffect(() => {
		if (!isAutoDismiss) return;

		const intervalMs = 50;
		const timer = setInterval(() => {
			if (isPausedRef.current) return;

			setRemainingTime((prev) => {
				const next = prev - intervalMs;
				if (next <= 0) {
					clearInterval(timer);
					return 0;
				}
				return next;
			});
		}, intervalMs);

		return () => clearInterval(timer);
	}, [isAutoDismiss, duration]);

	useEffect(() => {
		if (isAutoDismiss && remainingTime <= 0) {
			onDismiss(toast.id);
		}
	}, [remainingTime, isAutoDismiss, onDismiss, toast.id]);

	const progress = isAutoDismiss
		? Math.max(0, Math.min(100, (remainingTime / duration) * 100))
		: 100;
	const progressBarColor = PROGRESS_BAR_COLORS[toast.type] ?? "bg-white/70";

	const handleMouseEnter = () => {
		isPausedRef.current = true;
		setIsPaused(true);
	};

	const handleMouseLeave = () => {
		isPausedRef.current = false;
		setIsPaused(false);
	};

	return (
		<div
			data-testid="toast-item"
			className={`relative overflow-hidden px-4 py-3 rounded-xl shadow-lg text-white flex items-center gap-2 transition-all duration-300 ease-out transform translate-y-0 opacity-100 ${
				TYPE_STYLES[toast.type] ?? TYPE_STYLES.info
			} ${toast.type === "loading" ? "cursor-default" : "cursor-pointer"}`}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
			onClick={() => {
				if (toast.type !== "loading" && toast.type !== "invitation") {
					onDismiss(toast.id);
				}
			}}
		>
			{toast.type === "loading" && (
				<Loader2 size={16} className="animate-spin shrink-0" data-testid="toast-loader" />
			)}
			{toast.type === "invitation" && (
				<Gamepad2 size={16} className="shrink-0 text-purple-200" data-testid="toast-invitation-icon" />
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

			{isAutoDismiss && (
				<div
					className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-700/50 overflow-hidden rounded-b"
					data-testid={`toast-progress-${toast.id}`}
				>
					<div
						className={`h-full transition-all linear ${progressBarColor}`}
						style={{ width: `${progress}%` }}
						data-testid="toast-progress-bar"
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
			className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-xs pointer-events-auto"
			data-testid="toast-container"
		>
			{visibleToasts.map((toast) => (
				<ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
			))}
		</div>
	);
}
