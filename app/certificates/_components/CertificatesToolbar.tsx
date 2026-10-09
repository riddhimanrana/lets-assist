"use client";

import { format } from "date-fns";
import { ArrowDown, ArrowUp, Calendar, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import type { DateFilter, SortKey } from "./certificate-hours";

const DATE_FILTER_LABEL: Record<DateFilter, string> = {
  all: "All time",
  "6months": "Last 6 months",
  year: "Last year",
  custom: "Custom range",
};

const SORT_LABEL: Record<SortKey, string> = {
  date: "Date",
  hours: "Hours",
  name: "Project name",
};

/** Search, date range and sort for the certificate record, on one line. */
export function CertificatesToolbar({
  searchTerm,
  onSearchTermChange,
  dateFilter,
  onDateFilterChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  sortBy,
  sortDirection,
  onSortChange,
}: {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  dateFilter: DateFilter;
  onDateFilterChange: (value: DateFilter) => void;
  startDate: Date | undefined;
  onStartDateChange: (value: Date | undefined) => void;
  endDate: Date | undefined;
  onEndDateChange: (value: Date | undefined) => void;
  sortBy: SortKey;
  sortDirection: "asc" | "desc";
  onSortChange: (value: SortKey) => void;
}) {
  const SortArrow = sortDirection === "desc" ? ArrowDown : ArrowUp;

  return (
    <div className="grid gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <InputGroup className="sm:max-w-sm">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            placeholder="Search..."
            aria-label="Search certificates"
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
          />
        </InputGroup>
        <div className="flex gap-2 sm:ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  className="flex-1 justify-start sm:flex-none"
                  aria-label="Filter by date range"
                >
                  <Calendar data-icon="inline-start" aria-hidden="true" />
                  {DATE_FILTER_LABEL[dateFilter]}
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Date range</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup
                  value={dateFilter}
                  onValueChange={(value) =>
                    onDateFilterChange(value as DateFilter)
                  }
                >
                  <DropdownMenuRadioItem value="all">
                    All time
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="6months">
                    Last 6 months
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="year">
                    Last year
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="custom">
                    Custom range
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  className="flex-1 justify-start sm:flex-none"
                  aria-label="Sort certificates"
                >
                  <SortArrow data-icon="inline-start" aria-hidden="true" />
                  {SORT_LABEL[sortBy]}
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Sort certificates</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
                  <DropdownMenuItem key={key} onClick={() => onSortChange(key)}>
                    {SORT_LABEL[key]}
                    {sortBy === key ? (
                      <SortArrow className="ml-auto" aria-hidden="true" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {dateFilter === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <DateButton
            label="Select start date"
            placeholder="Start"
            value={startDate}
            onChange={onStartDateChange}
          />
          <span className="text-muted-foreground text-sm">to</span>
          <DateButton
            label="Select end date"
            placeholder="End"
            value={endDate}
            onChange={onEndDateChange}
          />
          {(startDate || endDate) && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                onStartDateChange(undefined);
                onEndDateChange(undefined);
              }}
              aria-label="Clear date selection"
            >
              <X aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function DateButton({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: Date | undefined;
  onChange: (value: Date | undefined) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className={cn(
              "justify-start font-normal tabular-nums",
              !value && "text-muted-foreground",
            )}
            aria-label={label}
          >
            <Calendar data-icon="inline-start" aria-hidden="true" />
            {value ? format(value, "MM/dd/yy") : placeholder}
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0" align="start">
        <CalendarComponent
          mode="single"
          selected={value}
          onSelect={onChange}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
