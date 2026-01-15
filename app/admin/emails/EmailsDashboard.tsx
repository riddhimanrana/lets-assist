"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  listReceivedEmails,
  listSentEmails,
  getReceivedEmailDetails,
  getSentEmailDetails,
  sendSupportReply,
  forwardReceivedEmail,
} from "./actions";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  Inbox,
  Send,
  RefreshCw,
  Paperclip,
  Reply,
  Forward,
  Mail,
  Search,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

interface EmailsDashboardProps {
  initialReceived: ReceivedEmailSummary[];
  initialSent: SentEmailSummary[];
  receivedHasMore: boolean;
  sentHasMore: boolean;
}

type AttachmentSummary = {
  id: string;
  filename?: string | null;
  content_type?: string | null;
  content_disposition?: string | null;
  content_id?: string | null;
  size?: number | null;
  download_url?: string | null;
  expires_at?: string | null;
};

type ReceivedEmailSummary = {
  id: string;
  from: string;
  to: string[];
  subject?: string | null;
  created_at: string;
  message_id?: string | null;
  cc?: string[] | null;
  bcc?: string[] | null;
  attachments?: AttachmentSummary[] | null;
};

type SentEmailSummary = {
  id: string;
  from: string;
  to: string[];
  subject?: string | null;
  created_at: string;
  last_event?: string | null;
  scheduled_at?: string | null;
  tags?: { name: string; value: string }[] | null;
};

type ReceivedEmailDetail = {
  email: {
    id: string;
    subject?: string | null;
    from?: string | null;
    to?: string[] | null;
    cc?: string[] | null;
    bcc?: string[] | null;
    created_at?: string | null;
    html?: string | null;
    text?: string | null;
    headers?: Record<string, string | string[]> | null;
    message_id?: string | null;
  };
  attachments: AttachmentSummary[];
};

type SentEmailDetail = {
  email: {
    id: string;
    subject?: string | null;
    from?: string | null;
    to?: string[] | null;
    cc?: string[] | null;
    bcc?: string[] | null;
    created_at?: string | null;
    html?: string | null;
    text?: string | null;
    headers?: Record<string, string | string[]> | null;
    last_event?: string | null;
    tags?: { name: string; value: string }[] | null;
  };
  attachments: AttachmentSummary[];
};

export function EmailsDashboard({
  initialReceived,
  initialSent,
  receivedHasMore: initialReceivedHasMore,
  sentHasMore: initialSentHasMore,
}: EmailsDashboardProps) {
  const [activeTab, setActiveTab] = useState("inbox");
  const [receivedEmails, setReceivedEmails] = useState<ReceivedEmailSummary[]>(initialReceived);
  const [sentEmails, setSentEmails] = useState<SentEmailSummary[]>(initialSent);
  const [receivedHasMore, setReceivedHasMore] = useState(initialReceivedHasMore);
  const [sentHasMore, setSentHasMore] = useState(initialSentHasMore);
  const [selectedReceivedId, setSelectedReceivedId] = useState<string | null>(
    initialReceived[0]?.id ?? null,
  );
  const [selectedSentId, setSelectedSentId] = useState<string | null>(initialSent[0]?.id ?? null);
  const [receivedDetails, setReceivedDetails] = useState<Record<string, ReceivedEmailDetail>>({});
  const [sentDetails, setSentDetails] = useState<Record<string, SentEmailDetail>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [searchInbox, setSearchInbox] = useState("");
  const [searchSent, setSearchSent] = useState("");
  const [isRefreshing, startRefreshing] = useTransition();
  const [isReplyOpen, setIsReplyOpen] = useState(false);
  const [isForwardOpen, setIsForwardOpen] = useState(false);
  const [replyTo, setReplyTo] = useState("");
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replyIncludeOriginal, setReplyIncludeOriginal] = useState(true);
  const [forwardTo, setForwardTo] = useState("");
  const [forwardSubject, setForwardSubject] = useState("");
  const [forwardNote, setForwardNote] = useState("");
  const [forwardIncludeAttachments, setForwardIncludeAttachments] = useState(true);
  const [isSending, setIsSending] = useState(false);

  const selectedReceived = useMemo(
    () => receivedEmails.find((email) => email.id === selectedReceivedId) || null,
    [receivedEmails, selectedReceivedId],
  );

  const selectedSent = useMemo(
    () => sentEmails.find((email) => email.id === selectedSentId) || null,
    [sentEmails, selectedSentId],
  );

  const filteredReceived = useMemo(() => {
    if (!searchInbox.trim()) return receivedEmails;
    const query = searchInbox.toLowerCase();
    return receivedEmails.filter((email) =>
      [email.subject, email.from, ...(email.to || [])].some((value) =>
        value?.toLowerCase().includes(query),
      ),
    );
  }, [receivedEmails, searchInbox]);

  const filteredSent = useMemo(() => {
    if (!searchSent.trim()) return sentEmails;
    const query = searchSent.toLowerCase();
    return sentEmails.filter((email) =>
      [email.subject, email.from, ...(email.to || [])].some((value) =>
        value?.toLowerCase().includes(query),
      ),
    );
  }, [sentEmails, searchSent]);

  useEffect(() => {
    if (selectedReceivedId && !receivedDetails[selectedReceivedId]) {
      void loadReceivedDetails(selectedReceivedId);
    }
  }, [selectedReceivedId, receivedDetails]);

  useEffect(() => {
    if (selectedSentId && !sentDetails[selectedSentId]) {
      void loadSentDetails(selectedSentId);
    }
  }, [selectedSentId, sentDetails]);

  const loadReceivedDetails = async (emailId: string) => {
    setDetailLoadingId(emailId);
    const result = await getReceivedEmailDetails(emailId);
    if (hasData(result)) {
      const payload = result.data as ReceivedEmailDetail;
      setReceivedDetails((prev) => ({ ...prev, [emailId]: payload }));
    } else {
      toast.error(result.error);
    }
    setDetailLoadingId(null);
  };

  const loadSentDetails = async (emailId: string) => {
    setDetailLoadingId(emailId);
    const result = await getSentEmailDetails(emailId);
    if (hasData(result)) {
      const payload = result.data as SentEmailDetail;
      setSentDetails((prev) => ({ ...prev, [emailId]: payload }));
    } else {
      toast.error(result.error);
    }
    setDetailLoadingId(null);
  };

  const refreshInbox = () => {
    startRefreshing(async () => {
      const result = await listReceivedEmails({ limit: 50 });
      if (!hasData(result)) {
        toast.error(result.error);
        return;
      }
      const payload = result.data as ListPayload<ReceivedEmailSummary>;
      setReceivedEmails(payload.emails);
      setReceivedHasMore(payload.hasMore);
    });
  };

  const refreshSent = () => {
    startRefreshing(async () => {
      const result = await listSentEmails({ limit: 50 });
      if (!hasData(result)) {
        toast.error(result.error);
        return;
      }
      const payload = result.data as ListPayload<SentEmailSummary>;
      setSentEmails(payload.emails);
      setSentHasMore(payload.hasMore);
    });
  };

  const loadMoreReceived = async () => {
    const last = receivedEmails[receivedEmails.length - 1];
    if (!last) return;
    const result = await listReceivedEmails({ limit: 50, after: last.id });
    if (!hasData(result)) {
      toast.error(result.error);
      return;
    }
    const payload = result.data as ListPayload<ReceivedEmailSummary>;
    setReceivedEmails((prev) => [...prev, ...payload.emails]);
    setReceivedHasMore(payload.hasMore);
  };

  const loadMoreSent = async () => {
    const last = sentEmails[sentEmails.length - 1];
    if (!last) return;
    const result = await listSentEmails({ limit: 50, after: last.id });
    if (!hasData(result)) {
      toast.error(result.error);
      return;
    }
    const payload = result.data as ListPayload<SentEmailSummary>;
    setSentEmails((prev) => [...prev, ...payload.emails]);
    setSentHasMore(payload.hasMore);
  };

  const openReplyDialog = () => {
    if (!selectedReceived) return;
    const replyTarget = extractEmailAddress(selectedReceived.from);
    const subject = prefixSubject(selectedReceived.subject, "Re:");
    setReplyTo(replyTarget);
    setReplySubject(subject);
    setReplyBody("");
    setReplyIncludeOriginal(true);
    setIsReplyOpen(true);
  };

  const openForwardDialog = () => {
    if (!selectedReceived) return;
    const subject = prefixSubject(selectedReceived.subject, "Fwd:");
    setForwardTo("");
    setForwardSubject(subject);
    setForwardNote("");
    setForwardIncludeAttachments(true);
    setIsForwardOpen(true);
  };

  const handleSendReply = async () => {
    if (!selectedReceived) return;
    const detail = receivedDetails[selectedReceived.id];
    if (!detail?.email) {
      toast.error("Load the email details before replying.");
      return;
    }

    setIsSending(true);
    const references = buildReferences(detail.email.headers, selectedReceived.message_id ?? detail.email.message_id);
    const { html, text } = buildReplyBodies(replyBody, replyIncludeOriginal, detail.email.html, detail.email.text);

    const result = await sendSupportReply({
      to: replyTo,
      subject: replySubject,
      html,
      text,
      inReplyTo: selectedReceived.message_id ?? detail.email.message_id ?? undefined,
      references: references || undefined,
    });

    setIsSending(false);

    if (result.error) {
      toast.error(result.error);
      return;
    }

    toast.success("Reply sent successfully.");
    setIsReplyOpen(false);
  };

  const handleForwardEmail = async () => {
    if (!selectedReceived) return;
    setIsSending(true);

    const result = await forwardReceivedEmail({
      emailId: selectedReceived.id,
      to: forwardTo,
      subject: forwardSubject,
      note: forwardNote,
      includeAttachments: forwardIncludeAttachments,
    });

    setIsSending(false);

    if (result.error) {
      toast.error(result.error);
      return;
    }

    toast.success("Email forwarded.");
    setIsForwardOpen(false);
  };

  const inboxDetail = selectedReceivedId ? receivedDetails[selectedReceivedId] : null;
  const sentDetail = selectedSentId ? sentDetails[selectedSentId] : null;

  return (
    <div className="container mx-auto max-w-7xl space-y-6 py-8 px-4 md:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Support Emails</h1>
        <p className="text-muted-foreground">
          Manage inbound requests and outbound follow-ups from one unified inbox.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inbox</CardTitle>
            <Inbox className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{receivedEmails.length}</div>
            <p className="text-xs text-muted-foreground">Inbound emails</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sent</CardTitle>
            <Send className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sentEmails.length}</div>
            <p className="text-xs text-muted-foreground">Outbound emails</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Attachments</CardTitle>
            <Paperclip className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{countAttachments(receivedEmails)}</div>
            <p className="text-xs text-muted-foreground">Inbound files queued</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2 md:w-[320px]">
          <TabsTrigger value="inbox">Inbox</TabsTrigger>
          <TabsTrigger value="sent">Sent</TabsTrigger>
        </TabsList>

        <TabsContent value="inbox">
          <EmailPane
            title="Incoming"
            description="Support requests arriving via Resend Inbound."
            searchValue={searchInbox}
            onSearchChange={setSearchInbox}
            onRefresh={refreshInbox}
            isRefreshing={isRefreshing}
            list={filteredReceived}
            selectedId={selectedReceivedId}
            onSelect={setSelectedReceivedId}
            hasMore={receivedHasMore}
            onLoadMore={loadMoreReceived}
            renderMeta={(email) => (
              <Badge variant="secondary" className="gap-1 text-xs">
                <Paperclip className="h-3 w-3" />
                {email.attachments?.length ?? 0}
              </Badge>
            )}
          />
          <EmailDetail
            variant="received"
            email={selectedReceived}
            detail={inboxDetail}
            isLoading={detailLoadingId === selectedReceivedId}
            onReply={openReplyDialog}
            onForward={openForwardDialog}
          />
        </TabsContent>

        <TabsContent value="sent">
          <EmailPane
            title="Outbound"
            description="Messages sent from your support inbox."
            searchValue={searchSent}
            onSearchChange={setSearchSent}
            onRefresh={refreshSent}
            isRefreshing={isRefreshing}
            list={filteredSent}
            selectedId={selectedSentId}
            onSelect={setSelectedSentId}
            hasMore={sentHasMore}
            onLoadMore={loadMoreSent}
            renderMeta={(email) => (
              <Badge variant="outline" className="text-xs">
                {formatLastEvent(email.last_event)}
              </Badge>
            )}
          />
          <EmailDetail
            variant="sent"
            email={selectedSent}
            detail={sentDetail}
            isLoading={detailLoadingId === selectedSentId}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={isReplyOpen} onOpenChange={setIsReplyOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Reply to sender</DialogTitle>
            <DialogDescription>
              Send a threaded response and keep the conversation together.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Input value={replyTo} onChange={(event) => setReplyTo(event.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Subject</label>
              <Input value={replySubject} onChange={(event) => setReplySubject(event.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Message</label>
              <Textarea
                value={replyBody}
                onChange={(event) => setReplyBody(event.target.value)}
                placeholder="Write your reply..."
                className="min-h-[140px]"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Include original email</p>
                <p className="text-xs text-muted-foreground">
                  Appends the original message below your reply.
                </p>
              </div>
              <Switch
                checked={replyIncludeOriginal}
                onCheckedChange={setReplyIncludeOriginal}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsReplyOpen(false)} disabled={isSending}>
              Cancel
            </Button>
            <Button onClick={handleSendReply} disabled={isSending || !replyBody.trim()}>
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Reply className="h-4 w-4" />}
              <span className="ml-2">Send reply</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isForwardOpen} onOpenChange={setIsForwardOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Forward email</DialogTitle>
            <DialogDescription>
              Send the full email (with optional attachments) to another address.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Input value={forwardTo} onChange={(event) => setForwardTo(event.target.value)} placeholder="team@lets-assist.com" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Subject</label>
              <Input value={forwardSubject} onChange={(event) => setForwardSubject(event.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Note (optional)</label>
              <Textarea
                value={forwardNote}
                onChange={(event) => setForwardNote(event.target.value)}
                placeholder="Add a note for your team..."
                className="min-h-[120px]"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Include attachments</p>
                <p className="text-xs text-muted-foreground">
                  Forward the original files along with the message.
                </p>
              </div>
              <Switch
                checked={forwardIncludeAttachments}
                onCheckedChange={setForwardIncludeAttachments}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsForwardOpen(false)} disabled={isSending}>
              Cancel
            </Button>
            <Button onClick={handleForwardEmail} disabled={isSending || !forwardTo.trim()}>
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Forward className="h-4 w-4" />}
              <span className="ml-2">Forward</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface EmailPaneProps<T> {
  title: string;
  description: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  list: T[];
  selectedId: string | null;
  onSelect: (value: string) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  renderMeta: (email: T) => React.ReactNode;
}

function EmailPane<T extends { id: string; subject?: string | null; from?: string; to?: string[]; created_at: string }>(
  props: EmailPaneProps<T>,
) {
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card className="flex flex-col">
        <CardHeader className="space-y-1">
          <CardTitle className="text-base font-semibold">{props.title}</CardTitle>
          <CardDescription>{props.description}</CardDescription>
          <div className="flex items-center gap-2 pt-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={props.searchValue}
                onChange={(event) => props.onSearchChange(event.target.value)}
                placeholder="Search by subject or sender"
                className="pl-8"
              />
            </div>
            <Button variant="outline" size="icon" onClick={props.onRefresh} disabled={props.isRefreshing}>
              <RefreshCw className={cn("h-4 w-4", props.isRefreshing && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="flex-1 p-0">
          <ScrollArea className="h-[520px]">
            <div className="space-y-2 p-4">
              {props.list.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No emails to display yet.
                </div>
              ) : (
                props.list.map((email) => (
                  <button
                    key={email.id}
                    onClick={() => props.onSelect(email.id)}
                    className={cn(
                      "w-full rounded-lg border p-3 text-left transition hover:bg-muted/40",
                      props.selectedId === email.id && "border-primary/40 bg-muted",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold">
                        {email.subject || "(No subject)"}
                      </p>
                      {props.renderMeta(email)}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {email.from || email.to?.join(", ")}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {formatDate(email.created_at)}
                    </p>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
        {props.hasMore && (
          <CardFooter className="justify-center">
            <Button variant="ghost" size="sm" onClick={props.onLoadMore}>
              Load more
            </Button>
          </CardFooter>
        )}
      </Card>
      <div className="hidden lg:block" />
    </div>
  );
}

interface EmailDetailProps {
  variant: "received" | "sent";
  email: ReceivedEmailSummary | SentEmailSummary | null;
  detail: ReceivedEmailDetail | SentEmailDetail | null;
  isLoading: boolean;
  onReply?: () => void;
  onForward?: () => void;
}

function EmailDetail({ variant, email, detail, isLoading, onReply, onForward }: EmailDetailProps) {
  if (!email) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Select an email</CardTitle>
          <CardDescription>Choose an item from the list to view its details.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const resolvedDetail = detail?.email ?? null;
  const attachments = detail?.attachments ?? [];
  const headerEntries = resolvedDetail?.headers ? Object.entries(resolvedDetail.headers) : [];

  return (
    <Card className="mt-4">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-xl">{resolvedDetail?.subject || email.subject || "(No subject)"}</CardTitle>
            <CardDescription className="mt-1 flex flex-col gap-1">
              <span>From: {resolvedDetail?.from || email.from}</span>
              <span>To: {formatAddressList(resolvedDetail?.to || email.to)}</span>
              {resolvedDetail?.cc?.length ? <span>CC: {formatAddressList(resolvedDetail.cc)}</span> : null}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {variant === "received" && (
              <Button variant="outline" size="sm" onClick={onReply}>
                <Reply className="mr-2 h-4 w-4" />
                Reply
              </Button>
            )}
            {variant === "received" && (
              <Button variant="ghost" size="sm" onClick={onForward}>
                <Forward className="mr-2 h-4 w-4" />
                Forward
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="gap-1">
            <Mail className="h-3 w-3" />
            {variant === "received" ? "Inbound" : "Outbound"}
          </Badge>
          <span>{formatDate(resolvedDetail?.created_at || email.created_at)}</span>
          {variant === "sent" && "last_event" in email && email.last_event ? (
            <Badge variant="secondary">{formatLastEvent(email.last_event)}</Badge>
          ) : null}
        </div>

        <Tabs defaultValue="preview">
          <TabsList>
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="text">Plain text</TabsTrigger>
            <TabsTrigger value="headers">Headers</TabsTrigger>
            <TabsTrigger value="attachments">Attachments</TabsTrigger>
          </TabsList>
          <TabsContent value="preview">
            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading preview...
              </div>
            )}
            {!isLoading && resolvedDetail?.html ? (
              <iframe
                title="Email preview"
                className="min-h-[360px] w-full rounded-lg border bg-white"
                sandbox=""
                srcDoc={resolvedDetail.html}
                referrerPolicy="no-referrer"
              />
            ) : !isLoading ? (
              <p className="text-sm text-muted-foreground">No HTML preview available.</p>
            ) : null}
          </TabsContent>
          <TabsContent value="text">
            {resolvedDetail?.text ? (
              <pre className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                {resolvedDetail.text}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">No plain text version provided.</p>
            )}
          </TabsContent>
          <TabsContent value="headers">
            {headerEntries.length > 0 ? (
              <pre className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground">
                {JSON.stringify(resolvedDetail?.headers, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">Headers will appear once loaded.</p>
            )}
          </TabsContent>
          <TabsContent value="attachments">
            {attachments.length > 0 ? (
              <div className="grid gap-2">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex items-center justify-between rounded-lg border px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium">{attachment.filename || "Attachment"}</p>
                      <p className="text-xs text-muted-foreground">
                        {attachment.content_type || "Unknown type"}
                      </p>
                    </div>
                    {attachment.download_url ? (
                      <Button variant="outline" size="sm" asChild>
                        <a href={attachment.download_url} target="_blank" rel="noreferrer">
                          Download
                        </a>
                      </Button>
                    ) : (
                      <Badge variant="outline">Unavailable</Badge>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No attachments for this email.</p>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

type ListPayload<T> = {
  emails: T[];
  hasMore: boolean;
};

function hasData(
  result: { data?: unknown } | { error: string },
): result is { data: unknown } {
  return "data" in result && result.data !== undefined;
}

function formatAddressList(addresses?: string[] | null) {
  if (!addresses || addresses.length === 0) return "—";
  return addresses.join(", ");
}

function extractEmailAddress(value?: string) {
  if (!value) return "";
  const match = value.match(/<([^>]+)>/);
  return match ? match[1] : value;
}

function prefixSubject(subject: string | null | undefined, prefix: string) {
  if (!subject) return prefix;
  if (subject.toLowerCase().startsWith(prefix.toLowerCase())) return subject;
  return `${prefix} ${subject}`;
}

function formatLastEvent(event?: string | null) {
  if (!event) return "Unknown";
  return event.replace(/_/g, " ");
}

function countAttachments(emails: ReceivedEmailSummary[]) {
  return emails.reduce((total, email) => total + (email.attachments?.length ?? 0), 0);
}

function buildReplyBodies(
  body: string,
  includeOriginal: boolean,
  htmlOriginal?: string | null,
  textOriginal?: string | null,
) {
  const safeBody = body.trim();
  const htmlBody = `<p>${safeBody.replace(/\n/g, "<br />")}</p>`;
  const textBody = safeBody;

  if (!includeOriginal) {
    return { html: htmlBody, text: textBody };
  }

  const html = `${htmlBody}<hr />${htmlOriginal ?? ""}`;
  const text = `${textBody}\n\n---\n${textOriginal ?? ""}`;
  return { html, text };
}

function buildReferences(
  headers: Record<string, string | string[]> | null | undefined,
  messageId?: string | null,
) {
  if (!messageId) return "";
  if (!headers) return messageId;

  const existing = getHeaderValue(headers, "references");
  if (!existing) return messageId;
  const items = existing.split(/\s+/).filter(Boolean);
  return [...items, messageId].join(" ");
}

function getHeaderValue(headers: Record<string, string | string[]>, key: string) {
  const found = Object.entries(headers).find(([headerKey]) => headerKey.toLowerCase() === key);
  if (!found) return "";
  const value = found[1];
  return Array.isArray(value) ? value.join(" ") : value;
}
