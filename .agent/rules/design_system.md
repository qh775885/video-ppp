# Video Extractor - Design & Layout Rules

## 1. Technology Stack (技术栈)
- **Core Framework**: React 18+
- **Build Tool**: Vite
- **Styling**: Tailwind CSS (Utility-first)
- **UI Components**: Shadcn/UI concept (Radix UI primitives if needed, Lucide React icons)
- **State Management**: React Hooks (exclude global state lib unless necessary)

## 2. Layout Philosophy (布局哲学)
Strict Separation of Concerns. The UI is divided into three distinct zones that must NOT overlap in responsibility.

### Zone A: The Stage (Video Area)
- **Content**: Video Player element ONLY.
- **Behavior**: Responsive, always centers the video. No controls overlaying the video content itself (except the floating dock at the bottom).
- **Background**: Pure Black (#000).

### Zone B: The Cockpit (Control Bar)
- **Location**: Floating "Glass Dock" at the bottom center of the Stage.
- **Style**: Tiered (Progress Bar on top, Buttons below), Glassmorphism, Rounded.
- **Responsibility**: ALL control inputs.
    - Playback (Play/Pause, Seek).
    - **Settings** (Seek Step/Fast Forward time, Multiplier). *MOVED HERE from Sidebar.*
    - Tools (Portrait Mode Toggle/Ratio, Extract Button).
- **Interactive**: Must be keyboard accessible.

### Zone C: The Archives (Sidebar)
- **Location**: Fixed Right Panel (Width: 280px-320px).
- **Style**: Dark Glass/Panel, distinctly separated from the Stage.
- **Responsibility**: Result management ONLY.
    - Display captured frames (Gallery).
    - Cache folder selection.
    - Clear/Download/Open Folder actions.
- **Prohibition**: DO NOT place global app settings (like seek speed) here.

## 3. Visual Language (视觉语言)
- **Theme**: Dark Mode (Professional, Cinema-like).
- **Colors**:
    - Background: Slate/Zinc 950.
    - Primary: Indigo/Violet (Vibrant accents).
    - Text: White (High contrast for legibility).
- **Texture**: Glassmorphism (Backdrop blur) for floating elements.

## 4. Workflows (工作流)
- **React Migration**: All new features must be React components.
- **Tailwind**: No more vanilla CSS files (except base index.css). Use Tailwind classes.
