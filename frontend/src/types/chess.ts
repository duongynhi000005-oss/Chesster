/**
 * chess.ts
 *
 * Shared types for the board's analysis annotation overlay (right-click
 * arrows and square highlights). Squares are represented as [row, col]
 * tuples, matching the rest of the codebase (see MoveRecord in game.ts)
 * rather than algebraic notation.
 */

export type AnnotationColor = "green" | "red" | "yellow" | "blue";

export interface SquareHighlight {
	row: number;
	col: number;
	color: AnnotationColor;
}

export interface AnnotationArrow {
	from: [number, number];
	to: [number, number];
	color: AnnotationColor;
}

/**
 * Drag and drop state metadata for piece ghost and snap preview (#584).
 */
export interface PieceDragState {
	row: number;
	col: number;
	piece: string;
	pointerId: number;
	pointerType: string;
	x: number;
	y: number;
}

export interface SnapTargetPreview {
	square: [number, number];
	isLegal: boolean;
}
