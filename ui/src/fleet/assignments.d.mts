// Type declarations for assignments.mjs (the pure assignment-chip helper;
// milestone 35 / story 03 / task 01).
import type { WorkAssignment } from "./api";

export type AssignmentChip = {
  label: string;
  token: "muted" | "secondary" | "primary" | "destructive" | string;
  mark: string;
  motion: "none" | "pulse";
  note?: string;
};

export declare function assignmentChip(row: Partial<WorkAssignment> | null | undefined): AssignmentChip;

export type AssignmentSummaryEntry = { state: string; count: number };

export declare function assignmentSummary(
  rows: Partial<WorkAssignment>[] | null | undefined
): AssignmentSummaryEntry[];
