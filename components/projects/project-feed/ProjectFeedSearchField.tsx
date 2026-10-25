"use client";

import { Search, X } from "lucide-react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

import type { ProjectFeedFilterProps } from "./types";

export function ProjectFeedSearchField({
  searchTerm,
  setSearchTerm,
  className,
}: Pick<ProjectFeedFilterProps, "searchTerm" | "setSearchTerm"> & {
  className?: string;
}) {
  return (
    <InputGroup className={className}>
      <InputGroupAddon>
        <Search aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        aria-label="Search projects"
        placeholder="Search projects"
        value={searchTerm}
        onChange={(event) => setSearchTerm(event.target.value)}
      />
      {searchTerm ? (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label="Clear search"
            onClick={() => setSearchTerm("")}
          >
            <X aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}
