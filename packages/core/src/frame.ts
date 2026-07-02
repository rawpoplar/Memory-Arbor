import { estimateTokens } from "./index.ts";

export type ContextMarkerStatus = "memorized" | "discarded";
export type ContextPressure = "normal" | "near_limit" | "over_limit";

export type ContextRange = {
  start: number;
  end: number;
};

export type ContextMarker = {
  id: string;
  sourceKey: string;
  status: ContextMarkerStatus;
  nodeId?: string;
  range?: ContextRange;
  createdAt: string;
  updatedAt: string;
};

export type TemporaryWorkspaceRef = {
  ref: string;
  sourceKey: string;
  start: number;
  end: number;
  tokenEstimate: number;
  preview: string;
  role?: string;
  messageID?: string;
  partID?: string;
  latestUserMessage?: boolean;
};

export type TemporaryWorkspaceStatus = {
  refs: TemporaryWorkspaceRef[];
  tokenEstimate: number;
  maxTokens: number;
  pressureRatio: number;
  pressure: ContextPressure;
  updatedAt: string;
};

export type ContextFrameStore = {
  version: number;
  markers: ContextMarker[];
  lastWorkspace: TemporaryWorkspaceStatus;
  updatedAt: string;
};

export type ContextFrameOptions = {
  maxTokens: number;
  pressureRatio: number;
};

export function normalizeContextFrameStore(
  value: unknown,
  options: ContextFrameOptions,
  timestamp = nowIso(),
): ContextFrameStore {
  if (!value || typeof value !== "object")
    return createEmptyContextFrameStore(options, timestamp);

  const input = value as Partial<ContextFrameStore>;
  const markers = Array.isArray(input.markers)
    ? input.markers.filter(isContextMarker)
    : [];
  return {
    version: Number.isInteger(input.version) ? Number(input.version) : 0,
    markers,
    lastWorkspace: normalizeTemporaryWorkspaceStatus(
      input.lastWorkspace,
      options,
      timestamp,
    ),
    updatedAt:
      typeof input.updatedAt === "string" ? input.updatedAt : timestamp,
  };
}

export function createEmptyContextFrameStore(
  options: ContextFrameOptions,
  timestamp = nowIso(),
): ContextFrameStore {
  return {
    version: 0,
    markers: [],
    lastWorkspace: buildTemporaryWorkspaceStatus([], options, timestamp),
    updatedAt: timestamp,
  };
}

export function formatContextRef(
  sourceKey: string,
  range?: ContextRange,
): string {
  if (!range) return sourceKey;
  return `${sourceKey}@${range.start}:${range.end}`;
}

export function parseContextRef(
  ref: string,
): { sourceKey: string; range?: ContextRange } | null {
  const match = /^(.*)@(\d+):(\d+)$/.exec(ref);
  if (!match) return ref.trim() ? { sourceKey: ref } : null;

  const start = Number(match[2]);
  const end = Number(match[3]);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start
  )
    return null;
  return {
    sourceKey: match[1],
    range: { start, end },
  };
}

export function applyContextMarkersToText(
  sourceKey: string,
  text: string,
  markers: ContextMarker[],
): {
  text: string;
  refs: TemporaryWorkspaceRef[];
} {
  const activeMarkers = markers.filter(
    (marker) => marker.sourceKey === sourceKey,
  );
  if (activeMarkers.some((marker) => marker.range === undefined)) {
    return {
      text: "",
      refs: [],
    };
  }

  const ranges = mergeRanges(
    activeMarkers
      .map((marker) => marker.range)
      .filter((range): range is ContextRange => range !== undefined)
      .map((range) => clampRange(range, text.length))
      .filter((range): range is ContextRange => range !== null),
  );

  if (ranges.length === 0) {
    return {
      text,
      refs:
        text.length > 0
          ? [workspaceRef(sourceKey, text, 0, text.length, undefined)]
          : [],
    };
  }

  let cursor = 0;
  const chunks: string[] = [];
  const refs: TemporaryWorkspaceRef[] = [];
  for (const range of ranges) {
    if (cursor < range.start) {
      chunks.push(text.slice(cursor, range.start));
      refs.push(
        workspaceRef(sourceKey, text, cursor, range.start, {
          start: cursor,
          end: range.start,
        }),
      );
    }
    cursor = Math.max(cursor, range.end);
  }

  if (cursor < text.length) {
    chunks.push(text.slice(cursor));
    refs.push(
      workspaceRef(sourceKey, text, cursor, text.length, {
        start: cursor,
        end: text.length,
      }),
    );
  }

  return {
    text: chunks.join(""),
    refs,
  };
}

export function buildTemporaryWorkspaceStatus(
  refs: TemporaryWorkspaceRef[],
  options: ContextFrameOptions,
  timestamp = nowIso(),
): TemporaryWorkspaceStatus {
  const tokenEstimate = refs.reduce((sum, ref) => sum + ref.tokenEstimate, 0);
  return {
    refs,
    tokenEstimate,
    maxTokens: options.maxTokens,
    pressureRatio: options.pressureRatio,
    pressure: workspacePressure(tokenEstimate, options),
    updatedAt: timestamp,
  };
}

export function sameContextTarget(
  left: { sourceKey: string; range?: ContextRange },
  right: { sourceKey: string; range?: ContextRange },
): boolean {
  return (
    left.sourceKey === right.sourceKey &&
    left.range?.start === right.range?.start &&
    left.range?.end === right.range?.end
  );
}

function normalizeTemporaryWorkspaceStatus(
  value: unknown,
  options: ContextFrameOptions,
  timestamp: string,
): TemporaryWorkspaceStatus {
  if (!value || typeof value !== "object")
    return buildTemporaryWorkspaceStatus([], options, timestamp);
  const input = value as Partial<TemporaryWorkspaceStatus>;
  const refs = Array.isArray(input.refs)
    ? input.refs.filter(isTemporaryWorkspaceRef)
    : [];
  return {
    refs,
    tokenEstimate:
      typeof input.tokenEstimate === "number"
        ? input.tokenEstimate
        : refs.reduce((sum, ref) => sum + ref.tokenEstimate, 0),
    maxTokens:
      typeof input.maxTokens === "number" && input.maxTokens > 0
        ? input.maxTokens
        : options.maxTokens,
    pressureRatio:
      typeof input.pressureRatio === "number" &&
      input.pressureRatio > 0 &&
      input.pressureRatio <= 1
        ? input.pressureRatio
        : options.pressureRatio,
    pressure:
      input.pressure === "normal" ||
      input.pressure === "near_limit" ||
      input.pressure === "over_limit"
        ? input.pressure
        : workspacePressure(
            refs.reduce((sum, ref) => sum + ref.tokenEstimate, 0),
            options,
          ),
    updatedAt:
      typeof input.updatedAt === "string" ? input.updatedAt : timestamp,
  };
}

function workspacePressure(
  tokenEstimate: number,
  options: ContextFrameOptions,
): ContextPressure {
  if (tokenEstimate > options.maxTokens) return "over_limit";
  if (tokenEstimate >= Math.floor(options.maxTokens * options.pressureRatio))
    return "near_limit";
  return "normal";
}

function workspaceRef(
  sourceKey: string,
  fullText: string,
  start: number,
  end: number,
  range: ContextRange | undefined,
): TemporaryWorkspaceRef {
  const text = fullText.slice(start, end);
  return {
    ref: formatContextRef(sourceKey, range),
    sourceKey,
    start,
    end,
    tokenEstimate: estimateTokens(text),
    preview: previewText(text),
  };
}

function mergeRanges(ranges: ContextRange[]): ContextRange[] {
  const sorted = [...ranges].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const merged: ContextRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || range.start > previous.end) {
      merged.push({ ...range });
    } else {
      previous.end = Math.max(previous.end, range.end);
    }
  }
  return merged;
}

function clampRange(
  range: ContextRange,
  textLength: number,
): ContextRange | null {
  const start = Math.max(0, Math.min(range.start, textLength));
  const end = Math.max(0, Math.min(range.end, textLength));
  return end > start ? { start, end } : null;
}

function previewText(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 120
    ? `${normalized.slice(0, 117)}...`
    : normalized;
}

function isContextMarker(value: unknown): value is ContextMarker {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ContextMarker>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.sourceKey === "string" &&
    (candidate.status === "memorized" || candidate.status === "discarded") &&
    (candidate.nodeId === undefined || typeof candidate.nodeId === "string") &&
    (candidate.range === undefined || isContextRange(candidate.range)) &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

function isContextRange(value: unknown): value is ContextRange {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ContextRange>;
  return (
    Number.isInteger(candidate.start) &&
    Number.isInteger(candidate.end) &&
    Number(candidate.start) >= 0 &&
    Number(candidate.end) > Number(candidate.start)
  );
}

function isTemporaryWorkspaceRef(
  value: unknown,
): value is TemporaryWorkspaceRef {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TemporaryWorkspaceRef>;
  return (
    typeof candidate.ref === "string" &&
    typeof candidate.sourceKey === "string" &&
    Number.isInteger(candidate.start) &&
    Number.isInteger(candidate.end) &&
    Number(candidate.end) >= Number(candidate.start) &&
    typeof candidate.tokenEstimate === "number" &&
    Number.isFinite(candidate.tokenEstimate) &&
    typeof candidate.preview === "string"
  );
}

function nowIso(): string {
  return new Date().toISOString();
}
