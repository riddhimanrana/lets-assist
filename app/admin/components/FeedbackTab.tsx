"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Search, Filter, MessageSquareText } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { ProfileHoverCard } from "@/components/shared/ProfileHoverCard";
import { format } from "date-fns";

interface FeedbackItem {
  id: string;
  section: string; // issue, idea, other
  title: string;
  feedback: string;
  created_at: string;
  email: string;
  page_path?: string | null;
  profiles?: {
    full_name: string | null;
    avatar_url?: string | null;
    username?: string | null;
  } | null;
}

interface FeedbackTabProps {
  feedback: FeedbackItem[];
  onDelete?: (id: string) => Promise<void>;
}

export function FeedbackTab({ feedback, onDelete }: FeedbackTabProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackItem | null>(null);

  const filteredFeedback = feedback.filter(item => {
    const matchesSearch = 
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.feedback.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.email.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesType = typeFilter === "all" || item.section === typeFilter;

    return matchesSearch && matchesType;
  });

  const handleDelete = async (id: string) => {
    if (onDelete) {
      await onDelete(id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search feedback..."
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="issue">Issues</SelectItem>
              <SelectItem value="idea">Ideas</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground sm:text-sm">
            {filteredFeedback.length} results
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {filteredFeedback.map((item) => (
            <Card key={item.id} className="group">
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={item.section === 'issue' ? 'destructive' : 'secondary'}>
                        {item.section}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(item.created_at), 'MMM d, yyyy')}
                      </span>
                      {item.page_path && (
                        <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                          {item.page_path}
                        </span>
                      )}
                    </div>
                    <div>
                      <h3 className="text-base font-semibold leading-tight">{item.title}</h3>
                      <p
                        className="mt-2 text-sm text-muted-foreground line-clamp-3 cursor-pointer transition-colors group-hover:text-foreground"
                        onClick={() => setSelectedFeedback(item)}
                      >
                        {item.feedback}
                      </p>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                        <MessageSquareText className="h-4 w-4" />
                        <span className="sr-only">Feedback actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setSelectedFeedback(item)}>
                        View details
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDelete(item.id)}
                        className="text-destructive focus:text-destructive"
                      >
                        Dismiss feedback
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <ProfileHoverCard
                    username={item.profiles?.username || "unknown"}
                    fullName={item.profiles?.full_name || item.email}
                    avatarUrl={item.profiles?.avatar_url || undefined}
                  >
                    <div className="flex items-center gap-2 cursor-pointer">
                      {item.profiles?.avatar_url ? (
                        <Avatar className="h-7 w-7">
                          <AvatarImage src={item.profiles.avatar_url} />
                          <AvatarFallback>{item.profiles.full_name?.[0] || 'U'}</AvatarFallback>
                        </Avatar>
                      ) : (
                        <NoAvatar fullName={item.profiles?.full_name || item.email} className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-[10px]" />
                      )}
                      <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                        {item.profiles?.full_name || item.email}
                      </span>
                    </div>
                  </ProfileHoverCard>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedFeedback(item)}
                  >
                    Review
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="h-fit">
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Feedback summary</p>
              <p className="text-xl font-semibold">{filteredFeedback.length}</p>
              <p className="text-xs text-muted-foreground">Matching items</p>
            </div>
            <div className="grid gap-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Issues</span>
                <span className="font-medium">
                  {filteredFeedback.filter(item => item.section === 'issue').length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Ideas</span>
                <span className="font-medium">
                  {filteredFeedback.filter(item => item.section === 'idea').length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Other</span>
                <span className="font-medium">
                  {filteredFeedback.filter(item => item.section === 'other').length}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!selectedFeedback} onOpenChange={(open) => !open && setSelectedFeedback(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedFeedback?.title}</DialogTitle>
            <DialogDescription>
              Submitted by {selectedFeedback?.profiles?.full_name || selectedFeedback?.email} on {selectedFeedback && format(new Date(selectedFeedback.created_at), 'PPP')}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <Badge variant={selectedFeedback?.section === 'issue' ? 'destructive' : 'secondary'}>
              {selectedFeedback?.section}
            </Badge>
            {selectedFeedback?.page_path && (
              <p className="text-xs text-muted-foreground">
                Page: <span className="font-mono">{selectedFeedback.page_path}</span>
              </p>
            )}
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {selectedFeedback?.feedback}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
