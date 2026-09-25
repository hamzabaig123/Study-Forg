import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { PageHeader } from "@/components/common/PageHeader";
import { ShareLinkPanel } from "@/components/insights/ShareLinkPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useChapters,
  useClasses,
  useSubjects,
  useTopics,
} from "@/hooks/useContent";
import { useCreateShare, useRevokeShare, useShares } from "@/hooks/useSharing";
import type { Id, ShareLink } from "@/types";
import { Link } from "@tanstack/react-router";
import { Share2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

function shareUrl(token: string): string {
  return `${window.location.origin}/shared/${token}`;
}

export default function SharePage() {
  const classesQuery = useClasses();
  const sharesQuery = useShares();
  const createShare = useCreateShare();
  const revokeShare = useRevokeShare();

  const [classId, setClassId] = useState<Id | null>(null);
  const [subjectId, setSubjectId] = useState<Id | null>(null);
  const [chapterId, setChapterId] = useState<Id | null>(null);
  const [topicId, setTopicId] = useState<Id | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<ShareLink | null>(null);

  const subjectsQuery = useSubjects(classId);
  const chaptersQuery = useChapters(subjectId);
  const topicsQuery = useTopics(chapterId);

  const classes = classesQuery.data ?? [];
  const subjects = subjectsQuery.data ?? [];
  const chapters = chaptersQuery.data ?? [];
  const topics = topicsQuery.data ?? [];
  const shares = sharesQuery.data ?? [];

  const target = useMemo(() => {
    if (topicId !== null) return { __kind__: "topic" as const, topic: topicId };
    if (chapterId !== null)
      return { __kind__: "chapter" as const, chapter: chapterId };
    return null;
  }, [topicId, chapterId]);

  function handleCreate() {
    if (!target) return;
    createShare.mutate(target, {
      onSuccess: (result) => {
        if (result.__kind__ === "err") {
          toast.error("Couldn't create the share link.");
          return;
        }
        toast.success("Share link ready.");
      },
      onError: () => toast.error("Couldn't create the share link."),
    });
  }

  function handleRevoke() {
    if (!pendingRevoke) return;
    revokeShare.mutate(pendingRevoke.token, {
      onSuccess: () => {
        toast.success("Share link revoked.");
        setPendingRevoke(null);
      },
      onError: () => toast.error("Couldn't revoke the link."),
    });
  }

  return (
    <div data-ocid="share.page" className="space-y-8">
      <PageHeader
        eyebrow="Share"
        title="Publish a read-only link"
        description="Share a chapter or topic with anyone. Visitors see the questions without answers and never need an account."
      />

      <Card className="rounded-lg border-border/70 shadow-none">
        <CardHeader className="border-b border-border/60 px-5 py-4">
          <CardTitle className="font-display text-base font-semibold">
            Choose what to share
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0 space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Class
              </Label>
              <Select
                value={classId ? classId.toString() : undefined}
                onValueChange={(next) => {
                  setClassId(BigInt(next));
                  setSubjectId(null);
                  setChapterId(null);
                  setTopicId(null);
                }}
              >
                <SelectTrigger
                  className="w-full rounded-lg"
                  data-ocid="share.class_select"
                >
                  <SelectValue placeholder="Select a class" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((item) => (
                    <SelectItem
                      key={item.id.toString()}
                      value={item.id.toString()}
                    >
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-0 space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Subject
              </Label>
              <Select
                value={subjectId ? subjectId.toString() : undefined}
                disabled={classId === null}
                onValueChange={(next) => {
                  setSubjectId(BigInt(next));
                  setChapterId(null);
                  setTopicId(null);
                }}
              >
                <SelectTrigger
                  className="w-full rounded-lg"
                  data-ocid="share.subject_select"
                >
                  <SelectValue placeholder="Select a subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((item) => (
                    <SelectItem
                      key={item.id.toString()}
                      value={item.id.toString()}
                    >
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-0 space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Chapter
              </Label>
              <Select
                value={chapterId ? chapterId.toString() : undefined}
                disabled={subjectId === null}
                onValueChange={(next) => {
                  setChapterId(BigInt(next));
                  setTopicId(null);
                }}
              >
                <SelectTrigger
                  className="w-full rounded-lg"
                  data-ocid="share.chapter_select"
                >
                  <SelectValue placeholder="Select a chapter" />
                </SelectTrigger>
                <SelectContent>
                  {chapters.map((item) => (
                    <SelectItem
                      key={item.id.toString()}
                      value={item.id.toString()}
                    >
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-0 space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Topic (optional)
              </Label>
              <Select
                value={topicId ? topicId.toString() : undefined}
                disabled={chapterId === null}
                onValueChange={(next) => setTopicId(BigInt(next))}
              >
                <SelectTrigger
                  className="w-full rounded-lg"
                  data-ocid="share.topic_select"
                >
                  <SelectValue placeholder="Whole chapter" />
                </SelectTrigger>
                <SelectContent>
                  {topics.map((item) => (
                    <SelectItem
                      key={item.id.toString()}
                      value={item.id.toString()}
                    >
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-5">
            <p className="text-sm text-muted-foreground">
              {target
                ? topicId !== null
                  ? "Sharing a single topic."
                  : "Sharing the whole chapter."
                : "Pick a chapter, or a topic inside one."}
            </p>
            <Button
              type="button"
              className="rounded-full bg-gradient-primary text-primary-foreground"
              onClick={handleCreate}
              disabled={!target || createShare.isPending}
              data-ocid="share.create_button"
            >
              <Share2 className="size-4" aria-hidden="true" />
              {createShare.isPending ? "Creating…" : "Create share link"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ShareLinkPanel
        shares={shares}
        buildUrl={shareUrl}
        onRevoke={(token) => {
          const link = shares.find((item) => item.token === token);
          if (link) setPendingRevoke(link);
        }}
        isRevoking={revokeShare.isPending}
        revokingToken={pendingRevoke?.token ?? null}
      />

      <p className="text-sm text-muted-foreground">
        Want to hand out a file instead?{" "}
        <Link
          to="/export"
          className="font-medium text-accent underline-offset-4 hover:underline"
          data-ocid="share.export_link"
        >
          Export a chapter or topic
        </Link>
        .
      </p>

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null);
        }}
        title="Revoke this share link?"
        description="Anyone holding the link will lose access immediately. This cannot be undone."
        confirmLabel="Revoke link"
        destructive
        onConfirm={handleRevoke}
      />
    </div>
  );
}
