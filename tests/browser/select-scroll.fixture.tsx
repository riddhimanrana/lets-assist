import { useState } from "react";
import { createRoot } from "react-dom/client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function Fixture() {
  const [value, setValue] = useState("Option 1");
  return (
    <Dialog open>
      <DialogContent>
        <DialogTitle>Long menu fixture</DialogTitle>
        <DialogDescription>Select the final option.</DialogDescription>
        <Select value={value} onValueChange={(next) => setValue(next ?? "")}>
          <SelectTrigger aria-label="Long menu">
            <SelectValue>{value}</SelectValue>
          </SelectTrigger>
          <SelectContent
            alignItemWithTrigger={
              document.documentElement.dataset.alignTrigger === "true"
            }
          >
            <SelectGroup>
              {Array.from(
                { length: 24 },
                (_, index) => `Option ${index + 1}`,
              ).map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </DialogContent>
    </Dialog>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
