import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder, CharacterCount } from "@tiptap/extensions";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Underline as UnderlineIcon,
  Link as LinkIcon,
} from "lucide-react";
import { toast } from "sonner";

import { RICH_TEXT_PROSE_CLASSNAME } from "@/components/ui/rich-text-classnames";
import {
  createRichTextContentSync,
  resolveRichTextKeyIntent,
} from "@/components/ui/rich-text-editor-behavior";
import { sanitizeRichTextHtml } from "@/lib/security/html.client";
import { normalizeRichTextLinkUrl } from "@/lib/security/html";
import { cn } from "@/lib/utils";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  id?: string;
  /**
   * Shows a persistent bullet/numbered list toolbar. The bubble menu only
   * appears over a selection, so there is otherwise no way to start a list on
   * an empty line.
   */
  showListControls?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

export function RichTextEditor({
  content,
  onChange,
  placeholder = "e.g., Join us for a day of fun and community service...",
  maxLength,
  className,
  id,
  showListControls = false,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: RichTextEditorProps) {
  // Removed manual character count state
  const [mounted, setMounted] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const contentSyncRef = useRef(createRichTextContentSync());
  const sanitizeEditorContent = useCallback(
    (html: string): string => sanitizeRichTextHtml(html),
    [],
  );

  const extensions = useMemo(
    () => [
      // Lists are styled by RICH_TEXT_PROSE_CLASSNAME on the container. Per-node
      // classes would make the editor's HTML differ from the saved HTML.
      StarterKit.configure({
        link: {
          openOnClick: true,
          HTMLAttributes: {
            class:
              "text-primary underline hover:text-primary/80 hover:cursor-pointer",
            rel: "noopener noreferrer",
            target: "_blank",
          },
        },
      }),
      Placeholder.configure({
        placeholder,
        showOnlyWhenEditable: true,
        emptyEditorClass:
          "is-editor-empty before:content-[attr(data-placeholder)] before:float-left before:h-0 before:pointer-events-none before:text-muted-foreground",
      }),
      ...(maxLength ? [CharacterCount.configure({ limit: maxLength })] : []),
    ],
    [placeholder, maxLength],
  );

  const editor = useEditor({
    extensions,
    content: sanitizeEditorContent(content),
    onUpdate: ({ editor }) => {
      // Sanitize what leaves the editor, not the live document. The document is
      // already constrained by the ProseMirror schema and the link extension's
      // protocol check, while the canonical form drops the trailing empty
      // paragraph Enter had just created, so writing it back reverted Enter.
      const canonicalHtml = sanitizeEditorContent(editor.getHTML());

      if (contentSyncRef.current.recordLocalEdit(canonicalHtml)) {
        onChange(canonicalHtml);
      }
    },
    immediatelyRender: false,
    editorProps: {
      attributes: {
        ...(id ? { id } : {}),
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        ...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : {}),
        ...(ariaDescribedBy ? { "aria-describedby": ariaDescribedBy } : {}),
        class: cn(
          "min-h-[150px] max-h-[200px] overflow-y-auto w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          RICH_TEXT_PROSE_CLASSNAME,
          className,
        ),
      },
      handleKeyDown: (view, event) => {
        const intent = resolveRichTextKeyIntent(event);

        if (intent === "open-link-dialog") {
          event.preventDefault();
          openLinkDialog();
          return true;
        }

        if (intent === "new-paragraph" || intent === "line-break") {
          // The document handles the key. Stop it here so no ancestor form or
          // dialog can read the keystroke as a submit.
          event.stopPropagation();
          return false;
        }

        return false;
      },
    },
  });

  const openLinkDialog = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href || "";
    setLinkUrl(previousUrl);
    setLinkDialogOpen(true);
  }, [editor]);

  const handleLinkSubmit = useCallback(() => {
    if (!editor) return;

    const trimmedLink = linkUrl.trim();

    if (trimmedLink === "") {
      editor.chain().focus().unsetLink().run();
    } else {
      const normalizedUrl = normalizeRichTextLinkUrl(trimmedLink);

      if (!normalizedUrl) {
        toast.error(
          "Please enter a safe link using https://, http://, mailto:, tel:, or a relative path.",
        );
        return;
      }

      editor.chain().focus().setLink({ href: normalizedUrl }).run();
    }

    setLinkDialogOpen(false);
    setLinkUrl("");
  }, [editor, linkUrl]);

  const handleLinkRemove = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().unsetLink().run();
    setLinkDialogOpen(false);
    setLinkUrl("");
  }, [editor]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!editor) return;

    const sanitizedContent = sanitizeEditorContent(content);
    const contentToApply = contentSyncRef.current.receive(
      sanitizedContent,
      editor.getHTML(),
      editor.isFocused,
    );
    if (contentToApply !== null) {
      editor.commands.setContent(contentToApply, { emitUpdate: false });
    }
  }, [editor, content, sanitizeEditorContent]);

  useEffect(() => {
    if (!editor) return;
    const applyDeferredContent = () => {
      const contentToApply = contentSyncRef.current.flushOnBlur(
        editor.getHTML(),
      );
      if (contentToApply !== null) {
        editor.commands.setContent(contentToApply, { emitUpdate: false });
      }
    };
    editor.on("blur", applyDeferredContent);
    return () => {
      editor.off("blur", applyDeferredContent);
    };
  }, [editor]);

  const getCounterColor = (current: number, max: number | undefined) => {
    if (!max) return "text-muted-foreground";
    const percentage = (current / max) * 100;
    if (percentage >= 90) return "text-destructive";
    if (percentage >= 75) return "text-warning";
    return "text-muted-foreground";
  };

  const characterCount =
    typeof editor?.storage.characterCount?.characters === "function"
      ? editor.storage.characterCount.characters()
      : editor?.storage.characterCount?.characters;

  if (!editor || !mounted) {
    return (
      <div className="h-[174px] rounded-md border border-input bg-muted/10 animate-pulse" />
    );
  }

  return (
    <div className="space-y-2">
      {editor && (
        <BubbleMenu
          editor={editor}
          className="flex overflow-hidden rounded-md border bg-background p-1 shadow-md"
        >
          <ToggleGroup className="flex">
            <ToggleGroupItem
              value="bold"
              size="sm"
              aria-label="Toggle bold"
              onClick={() => editor.chain().focus().toggleBold().run()}
              data-state={editor.isActive("bold") ? "on" : "off"}
              className="px-1"
            >
              <Bold className="h-4 w-4" />
            </ToggleGroupItem>

            <ToggleGroupItem
              value="italic"
              size="sm"
              aria-label="Toggle italic"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              data-state={editor.isActive("italic") ? "on" : "off"}
              className="px-1"
            >
              <Italic className="h-4 w-4" />
            </ToggleGroupItem>

            <ToggleGroupItem
              value="underline"
              size="sm"
              aria-label="Toggle underline"
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              data-state={editor.isActive("underline") ? "on" : "off"}
              className="px-1"
            >
              <UnderlineIcon className="h-4 w-4" />
            </ToggleGroupItem>

            <ToggleGroupItem
              value="link"
              size="sm"
              aria-label="Add link"
              onClick={openLinkDialog}
              data-state={editor.isActive("link") ? "on" : "off"}
              className="px-1"
            >
              <LinkIcon className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
        </BubbleMenu>
      )}

      {showListControls && (
        <div
          role="group"
          aria-label="List formatting"
          className="flex items-center gap-1"
        >
          <Button
            type="button"
            size="icon-sm"
            variant={editor.isActive("bulletList") ? "secondary" : "ghost"}
            aria-pressed={editor.isActive("bulletList")}
            aria-label="Bulleted list"
            title="Bulleted list"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant={editor.isActive("orderedList") ? "secondary" : "ghost"}
            aria-pressed={editor.isActive("orderedList")}
            aria-label="Numbered list"
            title="Numbered list"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div>
        <EditorContent editor={editor} />
      </div>

      {maxLength && (
        <div className="flex justify-end">
          <span
            className={cn(
              "text-xs transition-colors",
              getCounterColor(characterCount || 0, maxLength),
            )}
          >
            {characterCount}/{maxLength}
          </span>
        </div>
      )}

      {/* Link Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Insert Link</DialogTitle>
            <DialogDescription>
              Enter the URL for the link. Leave empty to remove the link.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="link-url">URL</Label>
              <Input
                id="link-url"
                type="url"
                placeholder="https://example.com"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleLinkSubmit();
                  }
                }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            {editor?.isActive("link") && (
              <Button
                type="button"
                variant="destructive"
                onClick={handleLinkRemove}
              >
                Remove Link
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => setLinkDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleLinkSubmit}>
              {linkUrl ? "Apply" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
