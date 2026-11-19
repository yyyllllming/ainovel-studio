"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api";
import type { FoundationPayload } from "@/lib/types";
import { useToast } from "../toast";

export function ManualFoundationImport({
  projectId,
  disabled,
}: {
  projectId: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [jsonText, setJsonText] = useState("");
  const [pending, setPending] = useState(false);

  async function handleImport() {
    let payload: unknown;
    try {
      payload = JSON.parse(jsonText);
    } catch {
      toast("JSON 格式不正确，请检查逗号、引号和括号。", "error");
      return;
    }

    setPending(true);
    try {
      await apiPost<{ foundation: FoundationPayload }>(
        `/api/projects/${projectId}/foundation/import`,
        payload,
      );
      toast("人工设定已原样导入，没有调用创作模型。确认内容后即可锁定。", "success");
      setJsonText("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["foundation-workshop", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["progress", projectId] }),
        queryClient.refetchQueries({ queryKey: ["foundation-workshop", projectId], type: "active" }),
        queryClient.refetchQueries({ queryKey: ["project", projectId], type: "active" }),
      ]);
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "导入人工设定失败", "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <details className="workspace-item mt-4 px-4 py-4">
      <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">
        导入人工设定 JSON
      </summary>
      <div className="mt-4 grid gap-3">
        <p className="text-sm leading-6 text-[var(--ink-soft)]">
          适合已经写好故事圣经的作者。系统只校验并保存你提供的结构化设定，不会请求模型补写或改写。
        </p>
        <label className="text-sm font-medium text-[var(--ink)]" htmlFor="manual-foundation-json">
          人工设定 JSON
        </label>
        <textarea
          id="manual-foundation-json"
          aria-label="人工设定 JSON"
          className="form-input min-h-64 resize-y px-4 py-3 font-mono text-xs leading-6"
          placeholder='{"premise":"…","mainline":"…","storyHook":"…","styleCard":"…","characters":[],"worldview":[],"relationships":[]}'
          value={jsonText}
          onChange={(event) => setJsonText(event.target.value)}
          disabled={disabled || pending}
        />
        <button
          type="button"
          className="button-secondary w-fit"
          onClick={() => void handleImport()}
          disabled={disabled || pending || !jsonText.trim()}
        >
          {pending ? "导入中…" : "校验并导入"}
        </button>
        {disabled ? (
          <p className="text-xs text-[var(--ink-soft)]">正式设定已锁定；如需替换，请先回到项目设置解除锁定或重置设定。</p>
        ) : null}
      </div>
    </details>
  );
}
