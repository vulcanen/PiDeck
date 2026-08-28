import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionChangeReview } from "@pideck/contracts";

const MAX_CACHED_REVIEW_VIEWS = 40;
const DEFAULT_REVIEW_WIDTH = 700;
const DEFAULT_FILE_LIST_WIDTH = 220;

type ReviewViewState = {
  open: boolean;
  selectedReviewId: string | null;
  reviewWidth: number;
  fileListWidth: number;
};

type LoadedReviews = {
  scopeKey: string;
  records: SessionChangeReview[];
  loading: boolean;
};

const DEFAULT_VIEW_STATE: ReviewViewState = {
  open: false,
  selectedReviewId: null,
  reviewWidth: DEFAULT_REVIEW_WIDTH,
  fileListWidth: DEFAULT_FILE_LIST_WIDTH,
};

function reviewScopeKey(taskId: string | undefined, projectCwd: string): string {
  return taskId && projectCwd ? `${projectCwd}\u0000${taskId}` : "";
}

export function useChangeReview({ taskId, projectCwd, onError }: { taskId?: string; projectCwd: string; onError: (error: unknown) => void }) {
  const scopeKey = reviewScopeKey(taskId, projectCwd);
  const [loaded, setLoaded] = useState<LoadedReviews>({ scopeKey: "", records: [], loading: false });
  const [, setViewVersion] = useState(0);
  const requestRef = useRef(0);
  const latestStartedAtRef = useRef(0);
  const liveUpdatesRef = useRef(new Map<string, SessionChangeReview>());
  const viewStatesRef = useRef(new Map<string, ReviewViewState>());

  const updateViewState = useCallback((key: string, patch: Partial<ReviewViewState>) => {
    if (!key) return;
    const states = viewStatesRef.current;
    const current = states.get(key) ?? DEFAULT_VIEW_STATE;
    states.delete(key);
    states.set(key, { ...current, ...patch });
    while (states.size > MAX_CACHED_REVIEW_VIEWS) {
      const oldestKey = states.keys().next().value as string | undefined;
      if (!oldestKey) break;
      states.delete(oldestKey);
    }
    setViewVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    const requestId = ++requestRef.current;
    latestStartedAtRef.current = 0;
    liveUpdatesRef.current.clear();
    if (!scopeKey || !taskId || !projectCwd) {
      setLoaded({ scopeKey: "", records: [], loading: false });
      return;
    }
    setLoaded({ scopeKey, records: [], loading: true });
    void window.pideck.sessions.changeReviews(taskId, projectCwd).then((records) => {
      if (requestRef.current !== requestId) return;
      const liveUpdates = [...liveUpdatesRef.current.values()];
      const liveIds = new Set(liveUpdates.map((review) => review.id));
      const merged = [...records.filter((review) => !liveIds.has(review.id)), ...liveUpdates]
        .sort((a, b) => a.startedAt - b.startedAt);
      latestStartedAtRef.current = merged.at(-1)?.startedAt ?? 0;
      const preferredId = viewStatesRef.current.get(scopeKey)?.selectedReviewId;
      const selectedReviewId = preferredId && merged.some((review) => review.id === preferredId)
        ? preferredId
        : merged.at(-1)?.id ?? null;
      updateViewState(scopeKey, { selectedReviewId });
      setLoaded((current) => current.scopeKey === scopeKey ? { scopeKey, records: merged, loading: false } : current);
    }).catch((error) => {
      if (requestRef.current === requestId) {
        setLoaded({ scopeKey, records: [], loading: false });
        onError(error);
      }
    });
  }, [onError, projectCwd, scopeKey, taskId, updateViewState]);

  const viewState = scopeKey ? viewStatesRef.current.get(scopeKey) ?? DEFAULT_VIEW_STATE : DEFAULT_VIEW_STATE;
  const reviews = loaded.scopeKey === scopeKey ? loaded.records : [];
  const loading = Boolean(scopeKey) && (loaded.scopeKey !== scopeKey || loaded.loading);
  const latestReview = reviews.at(-1) ?? null;
  const launcherReview = latestReview?.files.length
    ? latestReview
    : [...reviews].reverse().find((review) => review.files.length > 0) ?? null;
  const selectedReview = reviews.find((review) => review.id === viewState.selectedReviewId) ?? latestReview;

  const setSelectedReviewId = useCallback((reviewId: string) => {
    updateViewState(scopeKey, { selectedReviewId: reviewId });
  }, [scopeKey, updateViewState]);
  const setReviewOpen = useCallback((open: boolean) => {
    updateViewState(scopeKey, { open });
  }, [scopeKey, updateViewState]);
  const setReviewWidth = useCallback((reviewWidth: number) => {
    updateViewState(scopeKey, { reviewWidth: Math.round(reviewWidth) });
  }, [scopeKey, updateViewState]);
  const setFileListWidth = useCallback((fileListWidth: number) => {
    updateViewState(scopeKey, { fileListWidth: Math.round(fileListWidth) });
  }, [scopeKey, updateViewState]);
  const openLatestReview = useCallback(() => {
    if (!launcherReview) return;
    updateViewState(scopeKey, { selectedReviewId: launcherReview.id, open: true });
  }, [launcherReview, scopeKey, updateViewState]);

  const applyUpdatedReview = useCallback((updatedTaskId: string, review: SessionChangeReview) => {
    if (updatedTaskId !== taskId || !scopeKey) return;
    liveUpdatesRef.current.set(review.id, review);
    setLoaded((current) => {
      const records = current.scopeKey === scopeKey ? current.records : [];
      return {
        scopeKey,
        records: [...records.filter((item) => item.id !== review.id), review].sort((a, b) => a.startedAt - b.startedAt),
        loading: current.scopeKey === scopeKey ? current.loading : false,
      };
    });
    if (review.startedAt >= latestStartedAtRef.current) {
      latestStartedAtRef.current = review.startedAt;
      if (!(viewStatesRef.current.get(scopeKey)?.open ?? false)) updateViewState(scopeKey, { selectedReviewId: review.id });
    }
  }, [scopeKey, taskId, updateViewState]);

  return {
    reviews,
    latestReview,
    launcherReview,
    selectedReview,
    selectedReviewId: viewState.selectedReviewId,
    setSelectedReviewId,
    reviewOpen: viewState.open,
    setReviewOpen,
    openLatestReview,
    reviewLoading: loading,
    reviewWidth: viewState.reviewWidth,
    setReviewWidth,
    fileListWidth: viewState.fileListWidth,
    setFileListWidth,
    applyUpdatedReview,
  };
}
