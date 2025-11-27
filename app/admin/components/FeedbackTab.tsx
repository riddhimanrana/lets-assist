"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Search, Filter, X } from "lucide-react";
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
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { NoAvatar } from "@/components/NoAvatar";
import { format } from "date-fns";

interface FeedbackItem {
  id: string;
  section: string; // issue, idea, other
  title: string;
  feedback: string;
  created_at: string;
  email: string;
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
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search feedback..."
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px]">
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
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredFeedback.map((item) => (
          <Card key={item.id} className="flex flex-col h-full">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <Badge variant={item.section === 'issue' ? 'destructive' : 'secondary'}>
                {item.section}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(item.id)}
                title="Dismiss Feedback"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="flex-1 space-y-4">
              <div>
                <h3 className="font-semibold truncate" title={item.title}>{item.title}</h3>
                <p 
                  className="text-sm text-muted-foreground mt-1 line-clamp-3 cursor-pointer hover:text-foreground transition-colors"
                  onClick={() => setSelectedFeedback(item)}
                >
                  {item.feedback}
                </p>
              </div>
              
              <div className="flex items-center justify-between pt-4 mt-auto border-t">
                <HoverCard>
                  <HoverCardTrigger asChild>
                    <div className="flex items-center gap-2 cursor-pointer">
                      {item.profiles?.avatar_url ? (
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={item.profiles.avatar_url} />
                          <AvatarFallback>{item.profiles.full_name?.[0] || 'U'}</AvatarFallback>
                        </Avatar>
                      ) : (
                        <NoAvatar fullName={item.profiles?.full_name || item.email} className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px]" />
                      )}
                      <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                        {item.profiles?.full_name || item.email}
                      </span>
                    </div>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-80">
                    <div className="flex justify-between space-x-4">
                      {item.profiles?.avatar_url ? (
                        <Avatar>
                          <AvatarImage src={item.profiles.avatar_url} />
                          <AvatarFallback>{item.profiles.full_name?.[0]}</AvatarFallback>
                        </Avatar>
                      ) : (
                        <NoAvatar fullName={item.profiles?.full_name || item.email} className="h-10 w-10 rounded-full bg-muted flex items-center justify-center" />
                      )}
                      <div className="space-y-1">
                        <h4 className="text-sm font-semibold">{item.profiles?.full_name || 'Unknown User'}</h4>
                        <p className="text-sm text-muted-foreground">
                          {item.email}
                        </p>
                        {item.profiles?.username && (
                          <p className="text-xs text-muted-foreground">@{item.profiles.username}</p>
                        )}
                      </div>
                    </div>
                  </HoverCardContent>
                </HoverCard>
                
                <span className="text-xs text-muted-foreground">
                  {format(new Date(item.created_at), 'MMM d, yyyy')}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!selectedFeedback} onOpenChange={(open) => !open && setSelectedFeedback(null)}>
        <DialogContent>
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
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {selectedFeedback?.feedback}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
