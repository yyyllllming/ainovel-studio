import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthorImportSection } from "@/components/author/author-import-section";

function renderSection() {
  const onUpload = vi.fn().mockResolvedValue(undefined);
  const onCreateBookImportPreview = vi.fn().mockResolvedValue({});
  const onApplyBookImportPreview = vi.fn().mockResolvedValue(undefined);
  const onToggleImport = vi.fn();
  const onDeleteImport = vi.fn().mockResolvedValue(undefined);
  const onGenerateSelected = vi.fn().mockResolvedValue(undefined);

  render(
    <AuthorImportSection
      imports={[]}
      selectedImportIds={[]}
      uploadPending={false}
      bookImportPreviewPending={false}
      bookImportApplyPending={false}
      generatePending={false}
      deletingImportId={null}
      onToggleImport={onToggleImport}
      onUpload={onUpload}
      onCreateBookImportPreview={onCreateBookImportPreview}
      onApplyBookImportPreview={onApplyBookImportPreview}
      onDeleteImport={onDeleteImport}
      onGenerateSelected={onGenerateSelected}
    />,
  );

  return {
    onUpload,
  };
}

describe("AuthorImportSection", () => {
  it("lets users choose a file and uploads only after confirmation", async () => {
    const { onUpload } = renderSection();
    const file = new File(["正文"], "sample.txt", { type: "text/plain" });

    fireEvent.change(screen.getByLabelText("选择 TXT / MD 文件"), {
      target: { files: [file] },
    });

    expect(screen.getByText("已选择：sample.txt")).toBeInTheDocument();
    expect(onUpload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "导入文本" }));

    await waitFor(() => {
      expect(onUpload).toHaveBeenCalledWith({
        file,
        title: undefined,
        author: undefined,
      });
    });
  });

  it("keeps the selected file when the upload fails so the user can retry", async () => {
    const onUpload = vi.fn().mockRejectedValue(new Error("导入文本失败"));
    render(
      <AuthorImportSection
        imports={[]}
        selectedImportIds={[]}
        uploadPending={false}
        bookImportPreviewPending={false}
        bookImportApplyPending={false}
        generatePending={false}
        deletingImportId={null}
        onToggleImport={vi.fn()}
        onUpload={onUpload}
        onCreateBookImportPreview={vi.fn().mockResolvedValue({})}
        onApplyBookImportPreview={vi.fn().mockResolvedValue(undefined)}
        onDeleteImport={vi.fn().mockResolvedValue(undefined)}
        onGenerateSelected={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const file = new File(["正文"], "sample.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("选择 TXT / MD 文件"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "导入文本" }));

    await waitFor(() => {
      expect(onUpload).toHaveBeenCalledTimes(1);
    });

    // 失败时不清空已选文件，方便直接重试；错误提示由上层 mutation 的 toast 负责。
    expect(screen.getByText("已选择：sample.txt")).toBeInTheDocument();
  });

  it("accepts dropped files and still waits for manual import", async () => {
    const { onUpload } = renderSection();
    const file = new File(["# 标题"], "sample.md", { type: "text/markdown" });
    const dropzone = screen.getByRole("button", {
      name: "点击选择 TXT / MD，或直接拖拽到这里",
    });

    fireEvent.dragEnter(dropzone, {
      dataTransfer: {
        files: [file],
        types: ["Files"],
      },
    });

    expect(screen.getByText("松开鼠标即可选择这个文件")).toBeInTheDocument();

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [file],
        types: ["Files"],
      },
    });

    expect(screen.getByText("已选择：sample.md")).toBeInTheDocument();
    expect(onUpload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "导入文本" }));

    await waitFor(() => {
      expect(onUpload).toHaveBeenCalledWith({
        file,
        title: undefined,
        author: undefined,
      });
    });
  });
});
