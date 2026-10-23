import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import Toast, { ToastItem, MAX_VISIBLE_TOASTS } from "../../src/components/Toast";
import { useToastStore } from "../../src/store/toastStore";

describe("Toast Component (Issue #585)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		useToastStore.getState().clearToasts();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("renders nothing when there are no toasts", () => {
		render(<Toast />);
		const toastContainer = screen.getByTestId("toast-container");
		expect(toastContainer).toBeInTheDocument();
		expect(toastContainer.children.length).toBe(0);
	});

	it("renders a toast with message and correct progress bar", () => {
		act(() => {
			useToastStore.getState().addToast("Operation succeeded", "success", undefined, 5000);
		});

		render(<Toast />);
		expect(screen.getByText("Operation succeeded")).toBeInTheDocument();

		const progressBar = screen.getByTestId("toast-progress-bar");
		expect(progressBar).toBeInTheDocument();
		expect(progressBar.style.width).toBe("100%");
	});

	it("updates countdown progress bar smoothly as time passes", () => {
		act(() => {
			useToastStore.getState().addToast("Updating balance...", "info", undefined, 1000);
		});

		render(<Toast />);
		const progressBar = screen.getByTestId("toast-progress-bar");
		expect(progressBar.style.width).toBe("100%");

		// Advance half of the duration (500ms)
		act(() => {
			vi.advanceTimersByTime(500);
		});

		const currentWidth = parseFloat(progressBar.style.width);
		expect(currentWidth).toBeLessThanOrEqual(55);
		expect(currentWidth).toBeGreaterThanOrEqual(45);
	});

	it("auto-dismisses after the duration completes", () => {
		act(() => {
			useToastStore.getState().addToast("Temporary alert", "info", undefined, 1000);
		});

		render(<Toast />);
		expect(screen.getByText("Temporary alert")).toBeInTheDocument();

		act(() => {
			vi.advanceTimersByTime(1050);
		});

		expect(screen.queryByText("Temporary alert")).not.toBeInTheDocument();
	});

	it("pauses countdown and progress bar on hover (mouseEnter) and resumes on leave", () => {
		act(() => {
			useToastStore.getState().addToast("Hover to read notice", "info", undefined, 1000);
		});

		render(<Toast />);
		const toastEl = screen.getByText("Hover to read notice").closest('[data-testid^="toast-"]')!;
		const progressBar = screen.getByTestId("toast-progress-bar");

		// Run 300ms
		act(() => {
			vi.advanceTimersByTime(300);
		});
		const widthBeforeHover = parseFloat(progressBar.style.width);

		// Hover cursor
		fireEvent.mouseEnter(toastEl);

		// Advance 2000ms while paused
		act(() => {
			vi.advanceTimersByTime(2000);
		});

		// Should still be in DOM and progress width should be frozen
		expect(screen.getByText("Hover to read notice")).toBeInTheDocument();
		const widthDuringHover = parseFloat(progressBar.style.width);
		expect(widthDuringHover).toBeCloseTo(widthBeforeHover, 1);

		// Mouse leaves
		fireEvent.mouseLeave(toastEl);

		// Advance remaining time + margin
		act(() => {
			vi.advanceTimersByTime(800);
		});

		// Now it should auto-dismiss
		expect(screen.queryByText("Hover to read notice")).not.toBeInTheDocument();
	});

	it("does not auto-dismiss or render progress bar for loading toasts", () => {
		act(() => {
			useToastStore.getState().addToast("Submitting move...", "loading");
		});

		render(<Toast />);
		expect(screen.getByText("Submitting move...")).toBeInTheDocument();
		expect(screen.getByTestId("toast-loader")).toBeInTheDocument();
		expect(screen.queryByTestId("toast-progress-bar")).not.toBeInTheDocument();

		// Advance long time
		act(() => {
			vi.advanceTimersByTime(10000);
		});

		expect(screen.getByText("Submitting move...")).toBeInTheDocument();
	});

	it("allows manual dismissal via close (X) button", () => {
		act(() => {
			useToastStore.getState().addToast("Closeable error", "error", undefined, 5000);
		});

		render(<Toast />);
		const closeButton = screen.getByLabelText("Dismiss");
		expect(closeButton).toBeInTheDocument();

		fireEvent.click(closeButton);
		expect(screen.queryByText("Closeable error")).not.toBeInTheDocument();
	});

	it("handles invitation action button click and dismissal", () => {
		const onActionClick = vi.fn();
		act(() => {
			useToastStore.getState().addToast("Challenge from Alice", "invitation", {
				label: "Accept",
				onClick: onActionClick,
			});
		});

		render(<Toast />);
		expect(screen.getByTestId("toast-invitation-icon")).toBeInTheDocument();
		const actionButton = screen.getByText("Accept");

		fireEvent.click(actionButton);
		expect(onActionClick).toHaveBeenCalledTimes(1);
		expect(screen.queryByText("Challenge from Alice")).not.toBeInTheDocument();
	});

	it("limits simultaneous visible toasts to 4 max and queues subsequent ones", () => {
		act(() => {
			useToastStore.getState().addToast("Toast 1", "info", undefined, 5000);
			useToastStore.getState().addToast("Toast 2", "info", undefined, 5000);
			useToastStore.getState().addToast("Toast 3", "info", undefined, 5000);
			useToastStore.getState().addToast("Toast 4", "info", undefined, 5000);
			useToastStore.getState().addToast("Toast 5", "info", undefined, 5000);
			useToastStore.getState().addToast("Toast 6", "info", undefined, 5000);
		});

		render(<Toast />);

		// Only the first 4 should be visible
		expect(screen.getByText("Toast 1")).toBeInTheDocument();
		expect(screen.getByText("Toast 2")).toBeInTheDocument();
		expect(screen.getByText("Toast 3")).toBeInTheDocument();
		expect(screen.getByText("Toast 4")).toBeInTheDocument();
		expect(screen.queryByText("Toast 5")).not.toBeInTheDocument();
		expect(screen.queryByText("Toast 6")).not.toBeInTheDocument();

		// Dismiss Toast 1
		const toast1Close = screen.getAllByLabelText("Dismiss")[0]!;
		fireEvent.click(toast1Close);

		// Now Toast 1 is gone, and Toast 5 becomes visible in the top 4
		expect(screen.queryByText("Toast 1")).not.toBeInTheDocument();
		expect(screen.getByText("Toast 5")).toBeInTheDocument();
		expect(screen.queryByText("Toast 6")).not.toBeInTheDocument();
	});
});
