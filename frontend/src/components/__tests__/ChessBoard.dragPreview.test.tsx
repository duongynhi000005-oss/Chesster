import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import ChessBoard from "../ChessBoard";
import { useGameStore } from "../../store/gameStore";

// Mock API and dependencies
vi.mock("../../api/gameApi", () => ({
	api: {
		makeMove: vi.fn(),
		getMoves: vi.fn().mockResolvedValue({ success: true, data: [] }),
		getGame: vi.fn().mockResolvedValue({ success: true, data: { status: "active", time_control_seconds: 600 } }),
		createGame: vi.fn(),
		joinGame: vi.fn(),
		resignGame: vi.fn(),
		offerDraw: vi.fn(),
		acceptDraw: vi.fn(),
		getChatHistory: vi.fn().mockResolvedValue({ success: true, data: [] }),
	},
}));

vi.mock("../../api/socket", () => ({
	socketService: {
		connect: vi.fn(),
		disconnect: vi.fn(),
		joinGame: vi.fn(),
		leaveGame: vi.fn(),
		onGameUpdate: vi.fn(),
		onChatMessage: vi.fn(),
		offGameUpdate: vi.fn(),
		offChatMessage: vi.fn(),
		sendChatMessage: vi.fn(),
		onRematchRequested: vi.fn(),
		offRematchRequested: vi.fn(),
		requestRematch: vi.fn(),
		onOpponentReconnecting: vi.fn(),
		offOpponentReconnecting: vi.fn(),
		onOpponentReconnected: vi.fn(),
		offOpponentReconnected: vi.fn(),
		sendReaction: vi.fn(),
		onReaction: vi.fn(),
		offReaction: vi.fn(),
		onTournamentMatchCompleted: vi.fn(),
		offTournamentMatchCompleted: vi.fn(),
		onTournamentMatchReady: vi.fn(),
		offTournamentMatchReady: vi.fn(),
	},
}));

vi.mock("../../services/soundService", () => ({
	soundService: {
		isEnabled: vi.fn().mockReturnValue(true),
		toggle: vi.fn().mockReturnValue(true),
		getVolume: vi.fn().mockReturnValue(0.8),
		setVolume: vi.fn(),
		move: vi.fn(),
		capture: vi.fn(),
		castle: vi.fn(),
		promote: vi.fn(),
		check: vi.fn(),
		gameStart: vi.fn(),
		gameEnd: vi.fn(),
		draw: vi.fn(),
	},
}));

const mockInitialBoard = [
	["r", "n", "b", "q", "k", "b", "n", "r"],
	["p", "p", "p", "p", "p", "p", "p", "p"],
	[".", ".", ".", ".", ".", ".", ".", "."],
	[".", ".", ".", ".", ".", ".", ".", "."],
	[".", ".", ".", ".", ".", ".", ".", "."],
	[".", ".", ".", ".", ".", ".", ".", "."],
	["P", "P", "P", "P", "P", "P", "P", "P"],
	["R", "N", "B", "Q", "K", "B", "N", "R"],
];

const renderChessBoard = () => {
	return render(
		<BrowserRouter>
			<ChessBoard />
		</BrowserRouter>
	);
};

describe("ChessBoard Drag Preview & Snap Preview (Issue #584)", () => {
	let makeMoveMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		makeMoveMock = vi.fn().mockResolvedValue(true);
		useGameStore.setState({
			gameCode: "TEST_DRAG_584",
			status: "active",
			board: mockInitialBoard,
			playerColor: "white",
			currentTurn: "white",
			isMoving: false,
			viewingIndex: null,
			makeMove: makeMoveMock,
		});
	});

	it("initializes without active drag piece or snap highlight", () => {
		renderChessBoard();
		expect(screen.queryByTestId("ghost-piece-overlay")).toBeNull();
		const squares = screen.getAllByRole("gridcell");
		squares.forEach((sq) => {
			expect(sq.getAttribute("data-snap-preview")).toBeNull();
		});
	});

	it("shows elevated custom ghost piece on drag start past threshold", () => {
		const { container } = renderChessBoard();
		const whitePawnSquare = screen.getByTestId("square-6-4"); // e2 pawn

		// Simulate pointerdown on white pawn
		fireEvent.pointerDown(whitePawnSquare, {
			pointerId: 1,
			pointerType: "mouse",
			clientX: 100,
			clientY: 100,
			button: 0,
		});

		// Move beyond threshold (threshold is 6px)
		const boardGrid = container.querySelector(".board-grid") || container.querySelector("[role='grid']");
		expect(boardGrid).toBeTruthy();

		act(() => {
			fireEvent.pointerMove(boardGrid!, {
				pointerId: 1,
				pointerType: "mouse",
				clientX: 120,
				clientY: 120,
			});
		});

		// Ghost piece overlay should appear
		const ghost = screen.getByTestId("ghost-piece-overlay");
		expect(ghost).toBeTruthy();
		expect(ghost.className).toContain("cursor-grabbing");
		expect(ghost.className).toContain("pointer-events-none");
		expect(ghost.className).toContain("ghost-piece-overlay");
	});

	it("displays snap highlight on legal target square during drag and clears on illegal square", () => {
		const { container } = renderChessBoard();
		const whitePawnSquare = screen.getByTestId("square-6-4"); // e2 pawn (row 6, col 4)
		const legalDestSquare = screen.getByTestId("square-4-4"); // e4 square (row 4, col 4)
		const illegalSquare = screen.getByTestId("square-4-0"); // a4 square (illegal for e2 pawn)

		// Mock getBoundingClientRect on board grid so squareFromPoint maps correctly
		const boardGrid = container.querySelector("[role='grid']") as HTMLElement;
		vi.spyOn(boardGrid, "getBoundingClientRect").mockReturnValue({
			left: 0,
			top: 0,
			width: 800,
			height: 800,
			right: 800,
			bottom: 800,
			x: 0,
			y: 0,
			toJSON: () => {},
		});

		// Start drag on e2 (col 4, row 6: x=450, y=650)
		fireEvent.pointerDown(whitePawnSquare, {
			pointerId: 1,
			pointerType: "mouse",
			clientX: 450,
			clientY: 650,
			button: 0,
		});

		// Move to e4 (col 4, row 4: x=450, y=450)
		act(() => {
			fireEvent.pointerMove(boardGrid, {
				pointerId: 1,
				pointerType: "mouse",
				clientX: 450,
				clientY: 450,
			});
		});

		// Legal destination should have snap preview highlight
		expect(legalDestSquare.getAttribute("data-snap-preview")).toBe("true");
		expect(legalDestSquare.className).toContain("ring-2");
		expect(legalDestSquare.className).toContain("ring-emerald-400/60");

		// Move to a4 (col 0, row 4: x=50, y=450 - illegal for e2 pawn)
		act(() => {
			fireEvent.pointerMove(boardGrid, {
				pointerId: 1,
				pointerType: "mouse",
				clientX: 50,
				clientY: 450,
			});
		});

		// Illegal destination should NOT have snap preview
		expect(illegalSquare.getAttribute("data-snap-preview")).toBeNull();
		expect(illegalSquare.className).not.toContain("ring-emerald-400/60");
	});

	it("executes move on drop onto a legal target square and cleans up drag state", async () => {
		const { container } = renderChessBoard();
		const whitePawnSquare = screen.getByTestId("square-6-4");
		const legalDestSquare = screen.getByTestId("square-4-4");

		const boardGrid = container.querySelector("[role='grid']") as HTMLElement;
		vi.spyOn(boardGrid, "getBoundingClientRect").mockReturnValue({
			left: 0,
			top: 0,
			width: 800,
			height: 800,
			right: 800,
			bottom: 800,
			x: 0,
			y: 0,
			toJSON: () => {},
		});

		// Start drag on e2
		fireEvent.pointerDown(whitePawnSquare, {
			pointerId: 1,
			pointerType: "mouse",
			clientX: 450,
			clientY: 650,
			button: 0,
		});

		// Move to e4
		act(() => {
			fireEvent.pointerMove(boardGrid, {
				pointerId: 1,
				pointerType: "mouse",
				clientX: 450,
				clientY: 450,
			});
		});

		// Drop (pointerUp) at e4
		await act(async () => {
			fireEvent.pointerUp(boardGrid, {
				pointerId: 1,
				pointerType: "mouse",
				clientX: 450,
				clientY: 450,
			});
		});

		// Verify makeMove was called
		expect(makeMoveMock).toHaveBeenCalledWith([6, 4], [4, 4], undefined);

		// Verify ghost overlay and snap highlights are removed
		expect(screen.queryByTestId("ghost-piece-overlay")).toBeNull();
		expect(legalDestSquare.getAttribute("data-snap-preview")).toBeNull();
	});

	it("resets drag state and clears highlights on pointerCancel", () => {
		const { container } = renderChessBoard();
		const whitePawnSquare = screen.getByTestId("square-6-4");
		const boardGrid = container.querySelector("[role='grid']") as HTMLElement;

		fireEvent.pointerDown(whitePawnSquare, {
			pointerId: 1,
			pointerType: "mouse",
			clientX: 100,
			clientY: 100,
			button: 0,
		});

		act(() => {
			fireEvent.pointerMove(boardGrid, {
				pointerId: 1,
				pointerType: "mouse",
				clientX: 150,
				clientY: 150,
			});
		});

		expect(screen.getByTestId("ghost-piece-overlay")).toBeTruthy();

		act(() => {
			fireEvent.pointerCancel(boardGrid, { pointerId: 1 });
		});

		expect(screen.queryByTestId("ghost-piece-overlay")).toBeNull();
	});

	it("handles touch drag gestures with Y-offset without triggering unhandled exceptions", () => {
		renderChessBoard();
		const whitePawnSquare = screen.getByTestId("square-6-4");

		// Touch start
		act(() => {
			fireEvent.touchStart(whitePawnSquare, {
				touches: [{ clientX: 200, clientY: 300 }],
			});
		});

		const ghost = screen.getByTestId("ghost-piece-overlay");
		expect(ghost).toBeTruthy();

		// Touch end
		act(() => {
			fireEvent.touchEnd(whitePawnSquare, {
				changedTouches: [{ clientX: 200, clientY: 200 }],
			});
		});

		expect(screen.queryByTestId("ghost-piece-overlay")).toBeNull();
	});
});
