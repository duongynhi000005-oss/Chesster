import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import Toast, { MAX_VISIBLE_TOASTS } from "../Toast";
import { useToastStore } from "../../store/toastStore";

describe("Toast Component (Issue #585)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		useToastStore.setState({ toasts: [] });
	});

	afterEach(() => {
		act(() => {
			vi.clearAllTimers();
		});
		vi.useRealTimers();
	});

	it("renders a toast notification with message and progress bar", () => {
		act(() => {
			useToastStore.getState().addToast("Transaction confirmed", "success");
		});

		render(<Toast />);

		expect(screen.getByText("Transaction confirmed")).toBeInTheDocument();
		const progressBar = screen.getByTestId("toast-progress-bar");
		expect(progressBar).toBeInTheDocument();
		expect(progressBar).toHaveStyle({ width: "100%" });
	});

	it("progress bar updates over time and auto-dismisses toast upon completion", () => {
		act(() => {
			useToastStore.getState().addToast("Auto dismiss test", "info", undefined, 1000);
		});

		render(<Toast />);
		expect(screen.getByText("Auto dismiss test")).toBeInTheDocument();

		// Advance time halfway (500ms)
		act(() => {
			vi.advanceTimersByTime(500);
		});

		const progressBar = screen.getByTestId("toast-progress-bar");
		expect(progressBar).toBeInTheDocument();
		const width = parseFloat(progressBar.style.width);
		expect(width).toBeLessThan(100);
		expect(width).toBeGreaterThan(0);

		// Advance remaining time
		act(() => {
			vi.advanceTimersByTime(600);
		});

		expect(screen.queryByText("Auto dismiss test")).not.toBeInTheDocument();
	});

	it("pauses auto-dismiss countdown on mouseEnter and resumes on mouseLeave", () => {
		act(() => {
			useToastStore.getState().addToast("Hover pause test", "warning", undefined, 1000);
		});

		render(<Toast />);
		const toastItem = screen.getByTestId("toast-item");
		expect(screen.getByText("Hover pause test")).toBeInTheDocument();

		// Advance 300ms
		act(() => {
			vi.advanceTimersByTime(300);
		});

		// Hover over the toast
		fireEvent.mouseEnter(toastItem);

		// Advance 1000ms while paused — toast should NOT be dismissed
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(screen.getByText("Hover pause test")).toBeInTheDocument();

		// Cursor leaves toast
		fireEvent.mouseLeave(toastItem);

		// Advance remaining ~700ms
		act(() => {
			vi.advanceTimersByTime(800);
		});

		expect(screen.queryByText("Hover pause test")).not.toBeInTheDocument();
	});

	it("immediately dismisses toast when close button ('X') is clicked", () => {
		act(() => {
			useToastStore.getState().addToast("Manual dismiss test", "error");
		});

		render(<Toast />);
		expect(screen.getByText("Manual dismiss test")).toBeInTheDocument();

		const dismissBtn = screen.getByRole("button", { name: "Dismiss" });
		fireEvent.click(dismissBtn);

		expect(screen.queryByText("Manual dismiss test")).not.toBeInTheDocument();
	});

	it("does not auto-dismiss loading toasts and does not render a progress bar", () => {
		act(() => {
			useToastStore.getState().addToast("Signing transaction...", "loading");
		});

		render(<Toast />);
		expect(screen.getByText("Signing transaction...")).toBeInTheDocument();
		expect(screen.queryByTestId("toast-progress-bar")).not.toBeInTheDocument();

		act(() => {
			vi.advanceTimersByTime(10000);
		});

		// Still present after 10s
		expect(screen.getByText("Signing transaction...")).toBeInTheDocument();
	});

	it("renders invitation toast action button and clicking it executes callback and dismisses", () => {
		const onAccept = vi.fn();
		act(() => {
			useToastStore.getState().addToast("Game invite from Grandmaster", "invitation", {
				label: "Join Game",
				onClick: onAccept,
			});
		});

		render(<Toast />);
		expect(screen.getByText("Game invite from Grandmaster")).toBeInTheDocument();

		const actionBtn = screen.getByRole("button", { name: "Join Game" });
		fireEvent.click(actionBtn);

		expect(onAccept).toHaveBeenCalledTimes(1);
		expect(screen.queryByText("Game invite from Grandmaster")).not.toBeInTheDocument();
	});

	it("limits simultaneous visible toasts to MAX_VISIBLE_TOASTS (4) and queues subsequent toasts", () => {
		act(() => {
			for (let i = 1; i <= 6; i++) {
				useToastStore.getState().addToast(`Toast Message ${i}`, "info", undefined, 5000);
			}
		});

		render(<Toast />);

		// Exactly 4 rendered items
		const items = screen.getAllByTestId("toast-item");
		expect(items).toHaveLength(MAX_VISIBLE_TOASTS);

		// First 4 messages visible
		expect(screen.getByText("Toast Message 1")).toBeInTheDocument();
		expect(screen.getByText("Toast Message 2")).toBeInTheDocument();
		expect(screen.getByText("Toast Message 3")).toBeInTheDocument();
		expect(screen.getByText("Toast Message 4")).toBeInTheDocument();
		// 5 and 6 queued
		expect(screen.queryByText("Toast Message 5")).not.toBeInTheDocument();
		expect(screen.queryByText("Toast Message 6")).not.toBeInTheDocument();

		// Dismiss Toast 1
		const dismissButtons = screen.getAllByRole("button", { name: "Dismiss" });
		fireEvent.click(dismissButtons[0]);

		// Now Toast 5 should pop into visible stack
		expect(screen.queryByText("Toast Message 1")).not.toBeInTheDocument();
		expect(screen.getByText("Toast Message 5")).toBeInTheDocument();
		expect(screen.getAllByTestId("toast-item")).toHaveLength(MAX_VISIBLE_TOASTS);
	});
});
