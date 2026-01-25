import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder, CharacterCount } from '@tiptap/extensions';
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Bold, Italic, Underline as UnderlineIcon, Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect } from 'react';

interface RichTextEditorProps {
    content: string;
    onChange: (html: string) => void;
    placeholder?: string;
    maxLength?: number;
    className?: string;
}

export function RichTextEditor({
    content,
    onChange,
    placeholder = "e.g., Join us for a day of fun and community service...",
    maxLength,
    className
}: RichTextEditorProps) {
    // Removed manual character count state
    const [mounted, setMounted] = useState(false);

    const extensions = [
        StarterKit.configure({
            bulletList: {
                HTMLAttributes: {
                    class: 'list-disc list-outside ml-4',
                },
            },
            orderedList: {
                HTMLAttributes: {
                    class: 'list-decimal list-outside ml-4',
                },
            },
            listItem: {
                HTMLAttributes: {
                    class: 'my-1',
                },
            },
            link: {
                openOnClick: true,
                HTMLAttributes: {
                    class: 'text-primary underline hover:text-primary/80 hover:cursor-pointer',
                    rel: 'noopener noreferrer',
                    target: '_blank',
                },
            },
        }),
        Placeholder.configure({
            placeholder,
            showOnlyWhenEditable: true,
            emptyEditorClass: 'is-editor-empty before:content-[attr(data-placeholder)] before:float-left before:h-0 before:pointer-events-none before:text-muted-foreground',
        }),
        // Add CharacterCount extension if maxLength is provided
        ...(maxLength ? [CharacterCount.configure({ limit: maxLength })] : [])
    ];

    const editor = useEditor({
        extensions,
        content: content,
        onUpdate: ({ editor }) => {
            const html = editor.getHTML();
            // Removed manual character count update
            onChange(html);
        },
        immediatelyRender: false,
        editorProps: {
            attributes: {
                class: cn(
                    "min-h-[150px] max-h-[200px] overflow-y-auto w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 prose prose-sm dark:prose-invert max-w-none",
                    className
                ),
            }
        }
    });

    const setLink = () => {
        if (!editor) return;

        const previousUrl = editor.getAttributes('link').href;
        const url = window.prompt('URL', previousUrl);

        if (url === null) {
            return;
        }

        if (url === '') {
            editor.chain().focus().unsetLink().run();
            return;
        }

        editor.chain().focus().setLink({ href: url }).run();
    };

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (editor && content !== editor.getHTML()) {
            editor.commands.setContent(content);
        }
    }, [editor, content]);

    const getCounterColor = (current: number, max: number | undefined) => {
        if (!max) return "text-muted-foreground";
        const percentage = (current / max) * 100;
        if (percentage >= 90) return "text-destructive";
        if (percentage >= 75) return "text-warning";
        return "text-muted-foreground";
    };

    const characterCount = typeof editor?.storage.characterCount?.characters === 'function'
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
                    <ToggleGroup type="multiple" className="flex">
                        <ToggleGroupItem
                            value="bold"
                            size="sm"
                            aria-label="Toggle bold"
                            onClick={() => editor.chain().focus().toggleBold().run()}
                            data-state={editor.isActive('bold') ? 'on' : 'off'}
                            className="px-1"
                        >
                            <Bold className="h-4 w-4" />
                        </ToggleGroupItem>

                        <ToggleGroupItem
                            value="italic"
                            size="sm"
                            aria-label="Toggle italic"
                            onClick={() => editor.chain().focus().toggleItalic().run()}
                            data-state={editor.isActive('italic') ? 'on' : 'off'}
                            className="px-1"
                        >
                            <Italic className="h-4 w-4" />
                        </ToggleGroupItem>

                        <ToggleGroupItem
                            value="underline"
                            size="sm"
                            aria-label="Toggle underline"
                            onClick={() => editor.chain().focus().toggleUnderline().run()}
                            data-state={editor.isActive('underline') ? 'on' : 'off'}
                            className="px-1"
                        >
                            <UnderlineIcon className="h-4 w-4" />
                        </ToggleGroupItem>

                        <ToggleGroupItem
                            value="link"
                            size="sm"
                            aria-label="Add link"
                            onClick={setLink}
                            data-state={editor.isActive('link') ? 'on' : 'off'}
                            className="px-1"
                        >
                            <LinkIcon className="h-4 w-4" />
                        </ToggleGroupItem>
                    </ToggleGroup>
                </BubbleMenu>
            )}

            <div>
                <EditorContent editor={editor} />
            </div>

            {maxLength && (
                <div className="flex justify-end">
                    <span
                        className={cn(
                            "text-xs transition-colors",
                            getCounterColor(characterCount, maxLength)
                        )}
                    >
                        {characterCount}/{maxLength}
                    </span>
                </div>
            )}
        </div>
    );
}
