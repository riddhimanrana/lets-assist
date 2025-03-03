"use client";

import React from "react";
import axios from "axios";
import useSWRInfinite from "swr/infinite";
import { useInView } from "react-intersection-observer";
import { ProjectViewToggle } from "./ProjectViewToggle";
import { Skeleton } from "@/components/ui/skeleton"; // shadcn Skeleton

const fetcher = (url: string) => axios.get(url).then((res) => res.data);

export const ProjectsInfiniteScroll: React.FC = () => {
  const limit = 20;
  const { data, error, size, setSize } = useSWRInfinite(
    (index) => `/api/projects?limit=${limit}&offset=${index * limit}`,
    fetcher
  );

  const projects = data ? ([] as any[]).concat(...data) : [];
  const { ref, inView } = useInView();

  React.useEffect(() => {
    if (inView && data && data[data.length - 1]?.length === limit) {
      setSize(size + 1);
    }
  }, [inView, data, setSize, size, limit]);

  if (!data && !error) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: limit }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    );
  }
  if (error) return <div>Error loading projects.</div>;

  return (
    <div>
      <ProjectViewToggle projects={projects} />
      <div ref={ref} />
    </div>
  );
};
