import type { Revision, Tiers } from "../brief";
import type { NewsCategory } from "../types";
import type { EventSource } from "./event-candidates";

export type EventSnapshot = { eventId: string; version: number };
export type EventContext = EventSnapshot & { leadSourceId: string; members: EventSource[] };
export type EventMergePreview = { target: EventContext; other: EventContext };

export type DeskSource = {
  id: string; slug: string; url: string; title: string; source_name: string;
  source_published_at: string; category: NewsCategory; publisher_id: string | null;
  triage: "inbox" | "selected" | "saved" | "dismissed";
  job_state: string | null; revision_id: string | null; excerpt?: string | null;
  source_image_url?: string | null; featured_week?: string | null;
};
export type DeskPublisher = {
  id: string; name: string; feed_url: string; enabled: boolean;
  last_attempt_at: string | null; last_success_at: string | null; last_error: string | null;
};
export type DeskJob = {
  id: string; story_id: string; state: string; error: string | null; cost: number | null;
  created_at: string; title: string; source_url: string; source_name: string; selected: boolean;
};
export type DeskRevision = Revision & { brief_sources: DeskSource };
export type DeskHistory = { id: string; action: string; version: number; created_at: string; content: Tiers };
export type DeskData = {
  sources: DeskSource[]; revisions: DeskRevision[]; jobs: DeskJob[]; publishers: DeskPublisher[];
  active: DeskRevision | null; history: DeskHistory[];
  counts: { inbox: number; selected: number; saved: number; dismissed: number; drafts: number; published: number; failed: number; queued: number; rejected: number };
  total: number; page: number; pageSize: number; selectedIds: string[]; attemptsToday: number; dailyAttemptLimit: number; autoDraft: boolean;
};
export type DeskQuery = { view?: string; id?: string; q?: string; publisher?: string; category?: string; status?: string; since?: string; page?: string };
export type DeskMutation =
  | { intent: "discover" }
  | { intent: "triage"; ids: string[]; state: "inbox" | "selected" | "saved" | "dismissed" }
  | { intent: "generate"; ids: string[]; confirmCharge: boolean }
  | { intent: "run-queued"; confirmCharge: boolean }
  | { intent: "regenerate"; id: string; confirmCharge: boolean }
  | { intent: "publisher"; id: string; enabled: boolean }
  | { intent: "auto-draft"; enabled: boolean; confirmCharge: boolean }
  | { intent: "daily-cap"; limit: number; confirmCharge: boolean }
  | { intent: "import-url"; url: string }
  | { intent: "event-detail"; id: string }
  | { intent: "event-search"; id: string; term: string }
  | { intent: "event-merge-preview"; id: string; otherId: string }
  | { intent: "event-merge"; id: string; otherId: string; expectedTarget: EventSnapshot; expectedOther: EventSnapshot }
  | { intent: "event-split" | "event-lead"; id: string }
  | { intent: "save"; id: string; version: number; content: Tiers }
  | { intent: "image"; id: string; version: number; imageSource: "source" | "upload" | "none"; imageAlt: string; imageUrl?: string | null }
  | { intent: "refresh-image"; id: string; version: number }
  | { intent: "feature"; id: string; week: string | null }
  | { intent: "publish"; id: string; version: number; sourceChecked: boolean; tiersChecked: boolean }
  | { intent: "reject"; id: string; version: number }
  | { intent: "fork"; id: string }
  | { intent: "restore"; id: string; historyId: string }
  | { intent: "suggest"; id: string; version: number; field: "oneLiner" | "shortVersion" | "wholePicture" | "whyItMatters"; instruction: "simplify" | "shorten" | "alternative"; confirmCharge: boolean };
export type DeskResult = {
  ok: boolean; message: string; code?: "conflict" | "invalid" | "failed";
  version?: number; revisionId?: string; slug?: string; attemptsToday?: number; dailyAttemptLimit?: number;
  imageUrl?: string | null; imageAlt?: string | null; imageSource?: "source" | "upload" | "none"; sourceImageUrl?: string | null; featuredWeek?: string | null;
  event?: EventContext; candidates?: EventSource[]; matches?: EventSource[]; mergePreview?: EventMergePreview;
  suggestion?: { field: "oneLiner" | "shortVersion" | "wholePicture" | "whyItMatters"; value: string | string[]; cost: number | null };
};
