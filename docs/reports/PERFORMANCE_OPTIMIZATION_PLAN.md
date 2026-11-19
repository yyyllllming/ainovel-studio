# AINovel Studio 性能优化实施方案（Batch E）

## 一、虚拟滚动实现

### 1.1 安装依赖

```bash
pnpm add @tanstack/react-virtual
```

### 1.2 优化 ProjectChapterList

**文件：** `src/components/project/project-chapter-list.tsx`

**当前问题：**
- 长篇项目可能有 200+ 章节
- 直接渲染所有章节导致 DOM 节点过多

**优化方案：**

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';

export function ProjectChapterList({
  projectId,
  projectStoryLength,
  units,
  isRunning,
}: ProjectChapterListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: units.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72, // 估算每个章节项高度（px-4 py-3 + gap）
    overscan: 5, // 预渲染上下各 5 个
  });

  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
      <p className="section-title px-1">Manuscript</p>
      <div className="mt-3" style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const unit = units[virtualItem.index];
          return (
            <Link
              key={unit.chapterNo}
              href={`/projects/${projectId}/chapters/${unit.chapterNo}`}
              className="workspace-item active flex items-center justify-between px-4 py-3"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {/* 现有内容保持不变 */}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
```

**预期提升：**
- 200 章节项目：DOM 节点从 200 降至 ~15（可见区域 + overscan）
- 首次渲染时间减少 ~70%
- 滚动性能提升至 60fps

### 1.3 优化 AuthorLibraryClient

**文件：** `src/components/author-library-client.tsx`

**当前问题：**
- 作者列表可能有 50+ 作者卡
- 侧边栏直接渲染所有作者

**优化方案：**

```tsx
// 在 AuthorLibraryClient 组件内
const authorListRef = useRef<HTMLDivElement>(null);

const authorVirtualizer = useVirtualizer({
  count: authorsQuery.data?.authors.length ?? 0,
  getScrollElement: () => authorListRef.current,
  estimateSize: () => 80, // 每个作者卡高度
  overscan: 3,
});

// 在 JSX 中替换第 317-337 行
<div ref={authorListRef} className="mt-4 grid gap-2" style={{ height: '400px', overflow: 'auto' }}>
  <div style={{ height: `${authorVirtualizer.getTotalSize()}px`, position: 'relative' }}>
    {authorVirtualizer.getVirtualItems().map((virtualItem) => {
      const author = (authorsQuery.data?.authors ?? [])[virtualItem.index];
      if (!author) return null;
      return (
        <button
          key={author.id}
          type="button"
          className={`workspace-item p-4 text-left ${selectedAuthorId === author.id ? "active" : ""}`}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${virtualItem.start}px)`,
          }}
          onClick={() => {
            setSelectedImportIds([]);
            setSelectedId(author.id);
          }}
        >
          {/* 现有内容 */}
        </button>
      );
    })}
  </div>
</div>
```

**预期提升：**
- 50 作者列表：DOM 节点从 50 降至 ~10
- 侧边栏滚动流畅度提升

---

## 二、React Query 配置优化

### 2.1 优化项目快照轮询

**文件：** `src/components/project/use-project-queries.ts`

**当前问题（第 54-60 行）：**
```tsx
const snapshotQuery = useQuery({
  queryKey: ["project", projectId],
  queryFn: () => apiGet<ProjectDetail>(`/api/projects/${projectId}`),
  initialData: initialSnapshot ?? undefined,
  refetchOnMount: "always",
  refetchInterval: 8000, // ❌ 即使未运行也每 8 秒刷新
});
```

**优化方案：**
```tsx
const snapshotQuery = useQuery({
  queryKey: ["project", projectId],
  queryFn: () => apiGet<ProjectDetail>(`/api/projects/${projectId}`),
  initialData: initialSnapshot ?? undefined,
  refetchOnMount: "always",
  staleTime: 5000, // ✅ 5 秒内认为数据新鲜
  refetchInterval: (query) => {
    const progress = query.state.data as ProjectDetail | undefined;
    // 仅运行时高频轮询
    if (progress?.runProgress?.running) {
      return 3000; // 运行时 3 秒
    }
    return 10000; // 空闲时 10 秒
  },
});
```

### 2.2 为静态数据增加 staleTime

**文件：** `src/components/dashboard-client.tsx`

**优化（第 124-129 行）：**
```tsx
const { data: profileData } = useQuery({
  queryKey: ["profiles"],
  queryFn: () => apiGet<{ profiles: LlmProfile[] }>("/api/settings/llm-profiles"),
  initialData: initialProfiles,
  refetchOnMount: false,
  staleTime: 5 * 60 * 1000, // ✅ 5 分钟内不重新请求
});

const { data: projectData, isLoading } = useQuery({
  queryKey: ["projects"],
  queryFn: () => apiGet<{ projects: ProjectSummary[] }>("/api/projects"),
  initialData: initialProjects,
  refetchOnMount: false,
  staleTime: 30 * 1000, // ✅ 30 秒内不重新请求
});
```

### 2.3 优化章节工坊轮询

**文件：** `src/components/chapter-workshop-client.tsx`

**当前配置（第 206-221 行）已经很好：**
```tsx
refetchInterval: (query) => {
  const payload = query.state.data as ChapterPayload | undefined;
  if (payload?.run.isStreaming) {
    return 1000; // ✅ 流式响应时 1 秒
  }
  if (payload?.run.isCurrentChapter || payload?.manualReview.awaiting) {
    return 5000; // ✅ 当前章节 5 秒
  }
  return false; // ✅ 其他情况不轮询
},
```

**无需修改，已是最佳实践。**

---

## 三、流式响应取消机制

### 3.1 扩展 API 工具函数

**文件：** `src/lib/api.ts`

**新增支持 AbortSignal：**

```tsx
export async function apiPost<T>(
  url: string,
  body?: unknown,
  options?: { signal?: AbortSignal }
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options?.signal, // ✅ 支持取消
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "请求失败");
  }
  return payload;
}
```

### 3.2 设定工坊流式取消

**文件：** `src/components/foundation/use-foundation-workshop-controller.tsx`

**优化（第 556-664 行）：**

```tsx
export function useFoundationWorkshopController({
  projectId,
  foundation,
  foundationLocked,
  sourceIdea,
}: {
  projectId: string;
  foundation: FoundationPayload | null;
  foundationLocked: boolean;
  sourceIdea?: SourceIdeaSummary | null;
}): UseFoundationWorkshopControllerResult {
  // ... 现有代码 ...
  
  // ✅ 新增：取消控制器引用
  const abortControllerRef = useRef<AbortController | null>(null);

  // ✅ 清理函数：组件卸载时取消请求
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  async function handleSendWorkshopMessage() {
    const outgoingMessage = message.trim();
    if (!outgoingMessage || foundationLocked || isWorkshopStreaming) {
      return;
    }

    // ✅ 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // ✅ 创建新的取消控制器
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setPendingUserMessage(outgoingMessage);
    resetStreamRenderer();
    setWorkshopProgress({
      stage: "context",
      progress: 8,
      message: "已收到你的想法，正在整理当前设定上下文。",
    });
    setMessage("");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(getFoundationWorkshopDraftStorageKey(projectId));
    }

    try {
      const payload = buildFoundationWorkshopRequestPayload({
        message: outgoingMessage,
        activeSession,
        resumeMode,
      });
      setResumePreference({
        sessionId: null,
        mode: "auto",
      });
      const response = await fetch(`/api/projects/${projectId}/foundation/workshop?stream=1`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-ainovel-stream": "1",
        },
        body: JSON.stringify(payload),
        signal: abortController.signal, // ✅ 传入取消信号
      });

      await readJsonLineStream<WorkshopStreamEvent>(response, async (event) => {
        // ✅ 检查是否已取消
        if (abortController.signal.aborted) {
          throw new Error("请求已取消");
        }

        if (event.type === "error") {
          throw new Error(event.error || "工作区更新失败");
        }

        // ... 现有事件处理 ...
      });
    } catch (error) {
      // ✅ 区分取消错误和其他错误
      if (error instanceof Error && error.name === "AbortError") {
        toast("请求已取消", "info");
        return;
      }

      setPendingUserMessage("");
      resetStreamRenderer();
      setWorkshopProgress(null);
      // ... 现有错误处理 ...
    } finally {
      abortControllerRef.current = null;
    }
  }

  // ... 返回值中新增取消函数 ...
  return {
    // ... 现有返回值 ...
    editorProps: {
      // ... 现有 props ...
      onCancelStream: () => {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
      },
    },
  };
}
```

### 3.3 章节生成流式取消

**文件：** `src/components/chapter-workshop-client.tsx`

**类似实现（第 206-221 行的 `chapterQuery` 已有轮询，无需流式取消）**

**实际需要取消的是用户主动触发的操作：**
- 生成多版本（第 369-378 行）
- 生成 Patch（第 243-257 行）

**优化方案：**

```tsx
export function ChapterWorkshopClient({
  projectId,
  chapterNo,
  initialChapter,
  initialConflicts,
}: {
  projectId: string;
  chapterNo: number;
  initialChapter?: ChapterPayload | null;
  initialConflicts?: { conflicts: Array<{ chapterNo: number; severity: string; message: string }> };
}) {
  // ... 现有代码 ...
  
  // ✅ 新增：取消控制器
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // ✅ 修改 simpleMutation 支持取消
  const simpleMutation = useMutation({
    mutationFn: async (payload: { url: string; body?: unknown; success: string }) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      await apiPost(payload.url, payload.body, { signal: abortController.signal });
      return payload.success;
    },
    onSuccess: async (message) => {
      setFeedback(message);
      await queryClient.invalidateQueries({ queryKey: ["chapter", projectId, chapterNo] });
      await queryClient.invalidateQueries({ queryKey: ["chapter-conflicts", projectId] });
    },
    onError: (error) => {
      if (error instanceof Error && error.name === "AbortError") {
        setFeedback("操作已取消");
        return;
      }
      setFeedback(error instanceof Error ? error.message : "操作失败");
    },
    onSettled: () => {
      abortControllerRef.current = null;
    },
  });

  // ... 其余代码保持不变 ...
}
```

---

## 四、图片懒加载

**结论：当前项目无图片使用，无需优化。**

如果未来需要添加图片（如作者卡封面、章节预览图），使用 Next.js `<Image />` 组件：

```tsx
import Image from 'next/image';

<Image
  src="/author-avatar.jpg"
  alt="作者头像"
  width={80}
  height={80}
  loading="lazy" // ✅ 懒加载
  placeholder="blur" // ✅ 模糊占位
/>
```

---

## 五、project-detail-client.tsx 数据流优化

### 5.1 缓存 renderMainPane 函数

**文件：** `src/components/project-detail-client.tsx`

**当前问题（第 53-127 行）：**
```tsx
function renderMainPane() {
  // 每次渲染都重新创建函数
  if (controller.activeTab === "characterBook") {
    return <CardLibraryClient key="character-book" projectId={projectId} defaultTab="character" />;
  }
  // ...
}
```

**优化方案：**

```tsx
const mainPaneContent = useMemo(() => {
  if (controller.activeTab === "characterBook") {
    return <CardLibraryClient key="character-book" projectId={projectId} defaultTab="character" />;
  }

  if (controller.activeTab === "worldBook") {
    return <CardLibraryClient key="world-book" projectId={projectId} defaultTab="world" />;
  }

  if (controller.activeTab === "outline" && controller.project) {
    return (
      <ChapterOutlineGrid
        projectId={projectId}
        storyLength={controller.project.storyLength}
        // ... 其他 props ...
      />
    );
  }

  if (controller.activeTab === "models") {
    return (
      <ModelAssignmentSection
        profiles={controller.profilesQuery.data?.profiles ?? []}
        // ... 其他 props ...
      />
    );
  }

  return (
    <FoundationWorkshopClient
      projectId={projectId}
      foundation={controller.snapshotQuery.data?.foundation ?? null}
      foundationLocked={controller.snapshotQuery.data?.foundationLocked ?? false}
      sourceIdea={controller.snapshotQuery.data?.sourceIdea ?? null}
    />
  );
}, [
  controller.activeTab,
  controller.project,
  controller.profilesQuery.data?.profiles,
  controller.effectiveAssignments,
  controller.snapshotQuery.data,
  projectId,
  // ... 其他依赖 ...
]);

// 在 JSX 中直接使用
return (
  <div className="flex h-[calc(100vh-1rem)] w-full">
    {/* ... */}
    <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto grid w-full max-w-5xl content-start gap-4 pb-10">
        <ProjectHeader {...controller.projectHeaderProps} />
        {mainPaneContent}
      </div>
    </main>
    {/* ... */}
  </div>
);
```

### 5.2 优化 use-project-detail-controller.tsx

**文件：** `src/components/project/use-project-detail-controller.tsx`

**当前问题（第 444-562 行）：**
- `projectHeaderProps`、`chapterListProps`、`runControlProps` 每次渲染都重新创建

**优化方案：**

```tsx
// 在 useProjectDetailController 函数内

const projectHeaderProps = useMemo(() => ({
  activeTabLabel,
  projectGenre: project?.genre ?? "载入中",
  narrativePersonLabel: project ? getNarrativePersonLabel(project.narrativePerson) : "第三人称",
  unitLabel,
  displayStatus,
  tabs,
  activeTab,
  onTabChange: setActiveTab,
  onToggleRightPanel: () => setShowRightPanel(!showRightPanel),
}), [activeTabLabel, project, unitLabel, displayStatus, tabs, activeTab, showRightPanel]);

const chapterListProps = useMemo(() => ({
  projectId,
  projectStoryLength: project?.storyLength ?? "long",
  units,
  isRunning,
}), [projectId, project?.storyLength, units, isRunning]);

const runControlProps = useMemo(() => ({
  projectId,
  activeTabLabel,
  project,
  progress,
  currentVolumeLabel: currentVolume?.label ?? "未进入分卷",
  forecastLabel,
  completionPercent,
  // ... 其他 props ...
  onClose: () => setShowRightPanel(false),
  onTriggerPrimaryRun: triggerPrimaryRun,
  // ... 其他回调 ...
}), [
  projectId,
  activeTabLabel,
  project,
  progress,
  currentVolume,
  forecastLabel,
  completionPercent,
  // ... 其他依赖 ...
]);

return {
  // ... 其他返回值 ...
  projectHeaderProps,
  chapterListProps,
  runControlProps,
};
```

---

## 六、预期性能提升总结

| 优化项 | 当前状态 | 优化后 | 预期提升 |
|--------|---------|--------|---------|
| **章节列表渲染** | 200 个 DOM 节点 | ~15 个 DOM 节点 | 首次渲染 -70%，滚动 60fps |
| **作者列表渲染** | 50 个 DOM 节点 | ~10 个 DOM 节点 | 侧边栏滚动流畅 |
| **项目快照轮询** | 固定 8 秒 | 运行时 3 秒 / 空闲 10 秒 | 网络请求 -40% |
| **静态数据缓存** | 每次 mount 重新请求 | 5 分钟 staleTime | 网络请求 -60% |
| **流式响应取消** | 无法取消 | AbortController | 避免无效请求 |
| **组件重渲染** | 每次创建新对象 | useMemo 缓存 | 重渲染 -30% |

**总体预期：**
- **首屏加载时间：** 减少 40-50%
- **运行时内存占用：** 减少 30-40%（虚拟滚动）
- **网络请求数：** 减少 50%（缓存优化）
- **用户交互响应：** 提升至 60fps（虚拟滚动 + 减少重渲染）

---

## 七、实施优先级

### P0（立即实施）
1. ✅ 虚拟滚动 - `ProjectChapterList`（影响最大）
2. ✅ React Query 轮询优化（减少无效请求）
3. ✅ 流式响应取消机制（用户体验）

### P1（本周内）
4. ✅ 虚拟滚动 - `AuthorLibraryClient`
5. ✅ `useMemo` 优化 - `project-detail-client.tsx`

### P2（未来迭代）
6. 图片懒加载（当前无需）
7. 代码分割（dynamic import）
8. Service Worker 缓存

---

## 八、测试验证

### 性能测试清单

1. **虚拟滚动测试**
   - [ ] 200 章节项目滚动流畅度
   - [ ] 50 作者列表滚动流畅度
   - [ ] Chrome DevTools Performance 录制

2. **网络请求测试**
   - [ ] 空闲状态下轮询频率
   - [ ] 运行状态下轮询频率
   - [ ] Chrome DevTools Network 面板验证

3. **取消机制测试**
   - [ ] 快速切换页面时请求取消
   - [ ] 组件卸载时请求取消
   - [ ] 控制台无 AbortError 警告

4. **重渲染测试**
   - [ ] React DevTools Profiler 录制
   - [ ] 切换 tab 时重渲染次数
   - [ ] Props 对象引用稳定性

---

## 九、回滚方案

如果优化后出现问题，可以快速回滚：

1. **虚拟滚动回滚：** 移除 `@tanstack/react-virtual`，恢复原始 `.map()` 渲染
2. **React Query 回滚：** 移除 `staleTime` 和动态 `refetchInterval`
3. **取消机制回滚：** 移除 `AbortController` 相关代码
4. **useMemo 回滚：** 移除 `useMemo` 包装，恢复直接创建对象

---

## 十、后续优化方向

1. **代码分割：** 使用 `next/dynamic` 懒加载大组件
2. **Web Worker：** 将大数据处理移至 Worker 线程
3. **IndexedDB 缓存：** 离线缓存项目数据
4. **SSR 优化：** 优化服务端渲染性能
5. **Bundle 分析：** 使用 `@next/bundle-analyzer` 分析打包体积
