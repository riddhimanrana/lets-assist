# Design system

How Let's Assist surfaces earn their visual treatment. This is the source of truth for buttons, badges, fields, cards, tabs, icons, and page layout. Tokens live in `app/globals.css`. Primitives live in `components/ui`. Screens use the primitives and never restate a recipe inline.

## The idea

Things you press look glossy. Things you read are flat. Things that sit above the page cast a shadow. Nothing else does.

Every element belongs to exactly one of five tiers. If you are unsure which, it is flat.

| Tier           | Feel                                                            | What belongs here                                                                                                           | Tokens                                                                         |
| -------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Glossy filled  | 3D. A sheen over the fill and a 1px inner edge.                 | The primary action, the default badge, a checked checkbox, a switch that is on, a progress fill, the selected calendar day. | `--button-primary-gloss`, `--button-primary-shadow`, `--button-pressed-shadow` |
| Glossy neutral | 3D, quiet. A faint gradient and inner edge on a neutral fill.   | Outline and secondary buttons, select triggers, toggles, the menubar, outline and secondary badges.                         | `--control-gloss`, `--control-shadow`                                          |
| Soft surface   | A sheet resting on the page. Barely-there sheen, hairline drop. | Cards, and the active pill of a segmented tab bar.                                                                          | `--card-gloss`, `--card-shadow`                                                |
| Flat           | No sheen, no shadow. A hairline border at most.                 | Text fields, tables, list rows, alerts, status badges, ghost and link buttons, page chrome, navigation.                     | `--surface-shadow` (empty)                                                     |
| Floating       | A real drop shadow, because it really is above the page.        | Popovers, menus, dialogs, sheets, drawers, tooltips, toasts, sticky action bars.                                            | Tailwind `shadow-md` and up                                                    |

Rules that follow from the tiers:

- A screen never adds `shadow-*`, a gradient, `backdrop-blur`, or a translucent fill to a control or a card. If a primitive looks wrong, fix the primitive.
- Do not put a card inside a card. Use a divider, a `SectionHeader`, or an `ItemGroup`.
- No hover lift, no scale on hover. Hover changes brightness or fill only.
- Radii come from the scale (`rounded-md`, `lg`, `xl`, `2xl`, `full`). No `rounded-[Npx]`.

## Buttons

| Variant             | Use it for                                                          | Tier           |
| ------------------- | ------------------------------------------------------------------- | -------------- |
| `default`           | The one primary action of a view or a card.                         | Glossy filled  |
| `outline`           | Secondary actions next to a primary.                                | Glossy neutral |
| `secondary`         | A secondary action on a tinted or busy background.                  | Glossy neutral |
| `ghost`             | Row actions, toolbar icons, navigation items.                       | Flat           |
| `destructive`       | The confirm button inside a destructive dialog or a danger section. | Flat, tinted   |
| `destructive-ghost` | A quiet destructive row action such as Remove.                      | Flat           |
| `link`              | Inline text navigation.                                             | Flat           |

- One filled primary per view, and at most one per card.
- Destructive actions confirm in an `AlertDialog` with Cancel (outline) and a destructive button.
- Labels are sentence case: "Save changes", not "Save Changes".
- Do not restyle a variant with `bg-*`, `hover:bg-*`, or `shadow-*`. Pick the right variant.

## Badges

Two kinds, and they look different on purpose.

- **Labels** say what something is: a role, a type, a count. They are glossy. Use `default` for the one that matters, `secondary` or `outline` for the rest.
- **Statuses** say what state something is in. They are flat tints so they never compete with a button. Use `success`, `warning`, `info`, `destructive`.

Never hand-tint a badge with palette classes such as `bg-emerald-500/10`. If a status has no variant, it is one of the four above.

## Fields

Text inputs, textareas, and input groups are flat: a hairline border, no shadow, no gradient. Select triggers are the exception, because you press them, so they are glossy neutral.

Build forms from `Field`, `FieldLabel`, `FieldDescription`, and `FieldError`. Use `InputGroup` for a leading icon or a prefix. Use `InputOTP` for every 6-digit code.

## Cards

A card is a soft surface: flat fill with a faint sheen and a hairline drop. It marks a group of related content. It is not decoration.

- Settings and forms use `SettingsSection` from `components/layout/SettingsSection.tsx`: title, description, optional status badge, the controls, and a footer row with a hint on the left and the action on the right. Destructive blocks use `tone="danger"`.
- Headline numbers use `StatStrip`: one card, divided cells. No coloured tiles.
- A status-tinted card tints its ring (`ring-warning/30`), never a second border.
- Clickable cards change their ring or fill on hover. They do not lift.

## Tabs

- **Segmented tabs** (the default `TabsList`): a muted track with a raised white active pill. Use for switching panes inside a card or a section.
- **Line tabs** (`variant="line"`): an underline. Use for page-level navigation between tabs of one entity, such as an organization's Overview, Members, and Projects.
- Never use ghost or secondary buttons as a tab bar.

## Alerts, empty states, notices

- Inline notices use `Alert` with `info`, `success`, `warning`, or `destructive`. They are flat tints.
- Empty states use `components/ui/empty.tsx`: an icon, a title, one line, and at most one action.
- Loading uses `Skeleton` in the shape of the content. No page-level entrance animations.

## Page layout

- Every page starts with `PageHeader` from `components/layout/PageHeader.tsx`: optional breadcrumb, title, one-line description, and right-aligned actions with one primary.
- A block inside a page or tab starts with `SectionHeader`.
- Containers: `max-w-6xl` for lists and profiles, `max-w-4xl` for forms, `max-w-3xl` for account settings. Horizontal padding is `px-4 sm:px-6` everywhere.
- Settings areas use a left section nav on desktop and a drawer or select on phones.
- Type scale: page title `text-2xl font-semibold`, section title `text-lg font-semibold`, card title via `CardTitle`, meta `text-sm text-muted-foreground`. No `text-[10px]`, no `font-black`, no uppercase tracked labels.

## Icons

Icons come from `lucide-react`. Animated icons come from `components/icons/animated`, which holds hover-animated versions from [lucide-animated](https://lucide-animated.com).

### Static icons (the default)

| Where                                 | Size                           | Notes                                                                |
| ------------------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| Inside a button                       | 16px, set by the button        | Mark the position with `data-icon="inline-start"` or `"inline-end"`. |
| Inside a badge                        | 12px, set by the badge         | One icon at most.                                                    |
| Navigation rows                       | 16px                           | Muted until the row is active.                                       |
| Empty state                           | 20 to 24px inside `EmptyMedia` | One icon.                                                            |
| Beside a field label or in a list row | 16px                           | Muted.                                                               |

- An icon that carries meaning on its own needs an `aria-label` on its control. A decorative icon gets `aria-hidden`.
- Do not use an icon and a coloured dot and a badge for the same status. Pick one.
- No hand-written inline SVG. If lucide has no match, ask before adding one.

### Animated icons

An animated icon plays once when its control is hovered or focused. It tells the user "this is pressable and here is what it does". It is never ambient.

Use an animated icon for:

- Navigation rows in a sidebar or settings nav.
- The leading icon of a page's primary action.
- Header actions such as notifications, search, and settings.
- The icon in an empty state, played once when it appears.

Do not use an animated icon for:

- Anything in a table row, a list of more than a few items, or a badge.
- Status and state: success, warning, error, loading. Those stay still.
- Destructive buttons. Motion should never make deleting feel playful.
- More than one icon per control.

How to wire one up. The control drives the icon, so it plays when the whole button or row is hovered, not only when the pointer is on the glyph:

```tsx
import { BellIcon, useAnimatedIcon } from "@/components/icons/animated";

const icon = useAnimatedIcon();

<Button variant="ghost" {...icon.triggerProps}>
  <BellIcon ref={icon.ref} size={16} aria-hidden="true" />
  Notifications
</Button>;
```

`useAnimatedIcon` skips the animation for people who prefer reduced motion. Icons never loop.

To add an icon, take the component from lucide-animated, put it in `components/icons/animated/<name>.tsx`, and export it from `index.ts`. Check that the file contains only SVG paths and `motion` code.

## Motion

- Press feedback comes from the primitives. Do not add `active:scale-*` to a screen.
- No entrance animations on pages, cards, or rows.
- Motion that does exist is short (under 500ms), runs once, and stops for reduced-motion users.

## Colour

- Interactive and status surfaces use the semantic tokens: `primary`, `success`, `warning`, `info`, `destructive`, `muted`.
- `--brand` is decorative only. Never put text or a control on it.
- No raw palette classes (`amber-500`, `emerald-600`, `red-500`) in screens.
- Dark surfaces are owned by the dark palette tokens in `app/globals.css`. The gloss tokens are tuned per theme and redeclared under `.dark`.

## Checklist for a new screen

1. Starts with `PageHeader`. One primary action.
2. Built from `Card`, `SettingsSection`, `Item`, `Table`, `Empty`, `Alert`.
3. No `shadow-*`, gradient, blur, or palette class in the screen file.
4. Every status is a status badge or an alert, in a semantic tone.
5. Icons follow the table above. At most a few animated ones, all on things you can press.
6. Works at phone width with no horizontal scroll.
