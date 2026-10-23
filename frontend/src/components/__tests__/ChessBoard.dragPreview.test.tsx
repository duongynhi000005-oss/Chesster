import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import ChessBoard from "../ChessBoard";
import { useGameStore } from "../../store/gameStore";
import { INITIAL_BOARD } from "../../utils/chessUtils";

// Mock API and socket dependencies
vi.mock("../../api/gameApi", () => ({
  api: {
    makeMove: vi.fn().mockResolvedValue({ success: true }),
    getMoves: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getGame: vi.fn().mockResolvedValue({
      success: true,
      data: { status: "active", time_control_seconds: 600 },
    }),
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
    lowTimeTick: vi.fn(),
    playAlert: vi.fn(),
  },
}));

const renderChessBoard = async () => {
  await act(async () => {
    render(
      <BrowserRouter>
        <ChessBoard />
      </BrowserRouter>
    );
  });
  const grid = screen.getByRole("grid");
  vi.spyOn(grid, "getBoundingClientRect").mockReturnValue({
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
  return grid;
};

describe("ChessBoard Drag-and-Drop Ghost & Snap Preview (#584)", () => {
  beforeEach(() => {
    useGameStore.setState({
      board: INITIAL_BOARD.map((r) => [...r]),
      gameCode: "test-game-584",
      playerColor: "white",
      currentTurn: "white",
      status: "active",
      selectedSquare: null,
      moveHistory: [],
      viewingIndex: null,
      isHapticsEnabled: false,
      isSettingsOpen: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the chessboard with all 64 squares and no initial drag preview", async () => {
    await renderChessBoard();

    // Initial white pawn on e2 (row 6, col 4)
    const e2Square = screen.getByTestId("square-6-4");
    expect(e2Square).toBeInTheDocument();
    expect(e2Square).not.toHaveAttribute("data-snap-preview");
    expect(screen.queryByTestId("ghost-piece-overlay")).not.toBeInTheDocument();
  });

  it("initiates piece drag on touch and renders centered elevated ghost piece overlay", async () => {
    const grid = await renderChessBoard();
    const e2Square = screen.getByTestId("square-6-4");

    // Touch start on e2 (pawn)
    await act(async () => {
      fireEvent.touchStart(e2Square, {
        touches: [{ clientX: 450, clientY: 650 }],
      });
    });

    // Touch move
    await act(async () => {
      fireEvent.touchMove(grid, {
        touches: [{ clientX: 450, clientY: 450 }],
      });
    });

    // Ghost piece overlay should appear
    const ghost = screen.getByTestId("ghost-piece-overlay");
    expect(ghost).toBeInTheDocument();
    expect(ghost).toHaveClass("ghost-piece-overlay");
  });

  it("highlights legal destination square with glowing snap preview during drag", async () => {
    const grid = await renderChessBoard();
    const e2Square = screen.getByTestId("square-6-4");

    // Pointer down on e2
    await act(async () => {
      fireEvent.pointerDown(e2Square, {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 450,
        clientY: 650,
        button: 0,
      });
    });

    // Pointer move exceeding DRAG_THRESHOLD_PX to e4 (row 4, col 4)
    await act(async () => {
      fireEvent.pointerMove(grid, {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 450,
        clientY: 450,
      });
    });

    // Legal move square e4 (row 4, col 4) should have snap preview highlight
    const e4Square = screen.getByTestId("square-4-4");
    expect(e4Square).toHaveAttribute("data-snap-preview", "true");
    expect(e4Square).toHaveClass("ring-2");
    expect(e4Square).toHaveClass("bg-emerald-500/10");

    // Illegal square e5 (row 3, col 4) should NOT have snap preview highlight
    const e5Square = screen.getByTestId("square-3-4");
    expect(e5Square).not.toHaveAttribute("data-snap-preview");
    expect(e5Square).not.toHaveClass("ring-2");
  });

  it("dims non-target squares during active drag", async () => {
    const grid = await renderChessBoard();
    const e2Square = screen.getByTestId("square-6-4");

    await act(async () => {
      fireEvent.pointerDown(e2Square, {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 450,
        clientY: 650,
        button: 0,
      });
    });

    await act(async () => {
      fireEvent.pointerMove(grid, {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 450,
        clientY: 450,
      });
    });

    // a1 square (row 7, col 0) is not a legal move for e2 pawn, so it should be dimmed
    const a1Square = screen.getByTestId("square-7-0");
    expect(a1Square).toHaveClass("opacity-75");
  });

  it("cleans up ghost overlay and snap preview when drag ends or is cancelled", async () => {
    const grid = await renderChessBoard();
    const e2Square = screen.getByTestId("square-6-4");

    await act(async () => {
      fireEvent.pointerDown(e2Square, {
        pointerId: 2,
        pointerType: "mouse",
        clientX: 450,
        clientY: 650,
        button: 0,
      });
    });

    await act(async () => {
      fireEvent.pointerMove(grid, {
        pointerId: 2,
        pointerType: "mouse",
        clientX: 450,
        clientY: 450,
      });
    });

    expect(screen.getByTestId("ghost-piece-overlay")).toBeInTheDocument();

    // Pointer cancel
    await act(async () => {
      fireEvent.pointerCancel(grid, {
        pointerId: 2,
      });
    });

    // Ghost and snap preview should be cleared
    expect(screen.queryByTestId("ghost-piece-overlay")).not.toBeInTheDocument();
    const e4Square = screen.getByTestId("square-4-4");
    expect(e4Square).not.toHaveAttribute("data-snap-preview");
  });
});
