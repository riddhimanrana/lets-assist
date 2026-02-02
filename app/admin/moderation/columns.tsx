"use client"

import { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, Eye, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { format } from "date-fns"
import { ProfileHoverCard } from "@/components/shared/ProfileHoverCard"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

export type ContentReport = {
    id: string;
    content_id?: string;
    content_type?: string;
    reason?: string | null;
    priority?: string | null;
    status?: string | null;
    created_at?: string | null;
    reporter?: {
        username?: string | null;
        full_name?: string | null;
        avatar_url?: string | null;
    } | null;
    creator_details?: {
        username?: string | null;
        full_name?: string | null;
        avatar_url?: string | null;
    } | null;
    ai_metadata?: {
        verdict?: string;
        confidence?: number;
        suggestedStatus?: string | null;
        suggestedAction?: string | null;
    } | null;
};

export type FlaggedContent = {
    id: string;
    content_id?: string;
    content_type?: string;
    status?: string | null;
    flag_type?: string | null;
    confidence_score?: number | string | null;
    severity?: string;
    created_at?: string | null;
    content_details?: {
        title?: string | null;
        username?: string | null;
        full_name?: string | null;
    } | null;
    creator_details?: {
        username?: string | null;
        full_name?: string | null;
        avatar_url?: string | null;
    } | null;
};

const formatConfidence = (val?: number | string | null) => {
    if (val === undefined || val === null) return "—";
    const num = Number(val);
    const normalized = num > 1 ? num : num * 100;
    return `${Math.round(Math.max(0, Math.min(100, normalized)))}%`;
};

export const getReportColumns = (
    onViewDetails: (report: ContentReport) => void,
): ColumnDef<ContentReport>[] => [
        {
            accessorKey: "reason",
            header: "Subject & Reporter",
            cell: ({ row }) => {
                const report = row.original;
                return (
                    <div className="flex flex-col gap-1.5 py-1">
                        <span className="font-medium line-clamp-1 text-base">
                            {report.reason || 'No reason provided'}
                        </span>
                        <div className="flex items-center text-sm text-muted-foreground gap-2">
                            <span className="capitalize text-xs font-semibold bg-secondary px-1.5 py-0.5 rounded-sm">
                                {report.content_type?.replace('_', ' ') || 'Content'}
                            </span>
                            <span className="text-muted-foreground/50 text-[10px]">•</span>
                            <div className="flex items-center gap-1">
                                <span className="text-xs">Reported by</span>
                                {report.reporter ? (
                                    <ProfileHoverCard
                                        username={report.reporter.username || 'unknown'}
                                        fullName={report.reporter.full_name || 'Anonymous'}
                                        avatarUrl={report.reporter.avatar_url || undefined}
                                        variant="profile"
                                    >
                                        <span className="text-primary hover:underline cursor-pointer font-medium text-xs">
                                            {report.reporter.full_name || report.reporter.username}
                                        </span>
                                    </ProfileHoverCard>
                                ) : (
                                    <span className="italic text-xs">Anonymous</span>
                                )}
                            </div>
                            <span className="text-muted-foreground/50 text-[10px]">•</span>
                            <span className="text-xs">{report.created_at ? format(new Date(report.created_at), 'MMM d') : '-'}</span>
                        </div>
                    </div>
                );
            },
        },
        {
            accessorKey: "ai_analysis",
            header: "AI Recommendation",
            cell: ({ row }) => {
                const ai = row.original.ai_metadata;
                if (!ai) return <span className="text-xs text-muted-foreground italic">Pending...</span>;

                const action = ai.suggestedAction || 'Review required';

                return (
                    <div className="flex items-center gap-2">
                        <div className={
                            `text-xs font-medium px-2.5 py-1 rounded-md border flex items-center gap-1.5
            ${ai.verdict === 'Safe' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900' :
                                ai.verdict?.includes('Violat') ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900' :
                                    'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900'}`
                        }>
                            <Sparkles className="h-3 w-3" />
                            {action}
                        </div>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger>
                                    <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-normal text-muted-foreground">
                                        {formatConfidence(ai.confidence)}
                                    </Badge>
                                </TooltipTrigger>
                                <TooltipContent>Confidence Score</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                );
            },
        },
        {
            accessorKey: "status",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                        className="-ml-4"
                    >
                        Status
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                )
            },
            cell: ({ row }) => {
                const status = row.original.status || 'pending';
                const variant = status === 'resolved' ? 'default' : status === 'dismissed' ? 'outline' : 'secondary';
                return (
                    <Badge variant={variant} className="capitalize font-normal">
                        {status.replace('_', ' ')}
                    </Badge>
                );
            },
        },
        {
            id: "actions",
            cell: ({ row }) => {
                return (
                    <Button variant="outline" size="sm" onClick={() => onViewDetails(row.original)}>
                        <Eye className="mr-2 h-3 w-3" />
                        View Details
                    </Button>
                )
            },
        },
    ]

export const getFlaggedColumns = (
    onViewDetails: (item: FlaggedContent) => void,
): ColumnDef<FlaggedContent>[] => [
        {
            id: "content_details",
            accessorFn: (row) => {
                const d = row.content_details;
                return [d?.title, d?.full_name, d?.username, row.content_id, row.content_type || ''].filter(Boolean).join(' ');
            },
            header: "Content Details",
            cell: ({ row }) => {
                const item = row.original;
                const title = item.content_details?.title || item.content_details?.full_name || item.content_details?.username || 'Untitled Content';

                return (
                    <div className="flex flex-col gap-1.5 py-1">
                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-2">
                                <span className="font-medium text-base">{title}</span>
                                {item.content_type && (
                                    <Badge variant="outline" className="text-[10px] capitalize h-5 px-1.5">
                                        {item.content_type}
                                    </Badge>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>Created by</span>
                            {item.creator_details ? (
                                <ProfileHoverCard
                                    username={item.creator_details.username || 'unknown'}
                                    fullName={item.creator_details.full_name || 'Anonymous'}
                                    avatarUrl={item.creator_details.avatar_url || undefined}
                                    variant="profile"
                                >
                                    <span className="text-primary hover:underline cursor-pointer font-medium">
                                        {item.creator_details.full_name || item.creator_details.username}
                                    </span>
                                </ProfileHoverCard>
                            ) : (
                                <span className="italic">Unknown User</span>
                            )}
                            <span className="text-muted-foreground/50">•</span>
                            <span>{item.created_at ? format(new Date(item.created_at), 'PPP') : '-'}</span>
                        </div>
                    </div>
                );
            },
        },
        {
            accessorKey: "status",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                        className="-ml-4"
                    >
                        Status
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                )
            },
            cell: ({ row }) => {
                const status = row.original.status || 'pending';
                const variant = status === 'blocked' ? 'destructive' : status === 'confirmed' ? 'default' : status === 'dismissed' ? 'outline' : 'secondary';
                return (
                    <Badge variant={variant} className="capitalize shadow-sm">
                        {status}
                    </Badge>
                );
            },
        },
        {
            accessorKey: "severity",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                        className="-ml-4"
                    >
                        Severity
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                )
            },
            cell: ({ row }) => {
                const severity = row.original.severity || 'unknown';
                const color = ['high', 'critical'].includes(severity.toLowerCase()) ? 'destructive' : severity === 'medium' ? 'default' : 'secondary';
                return (
                    <Badge variant={color} className="capitalize text-[11px]">
                        {severity}
                    </Badge>
                );
            },
        },
        {
            id: "actions",
            cell: ({ row }) => {
                return (
                    <Button variant="outline" size="sm" onClick={() => onViewDetails(row.original)}>
                        <Eye className="mr-2 h-3 w-3" />
                        View Details
                    </Button>
                )
            },
        },
    ]
