import { unlink } from "node:fs/promises";

type FileOpResult<T> =
  | string[]
  | {
      writtenFiles: string[];
      result: T;
    };

function normalizeFileOpResult<T>(result: FileOpResult<T>) {
  if (Array.isArray(result)) {
    return {
      writtenFiles: result,
      result: undefined as T | undefined,
    };
  }

  return {
    writtenFiles: result.writtenFiles,
    result: result.result,
  };
}

/**
 * 先写文件，再执行 DB 操作。
 * 如果 DB 失败，自动删除已写文件作为补偿。
 */
export async function writeFileThenDb<T = void>(
  fileOps: () => Promise<FileOpResult<T>>,
  dbOp: (result: T | undefined) => void | Promise<void>,
): Promise<void>;
export async function writeFileThenDb<T, R>(
  fileOps: () => Promise<FileOpResult<T>>,
  dbOp: (result: T | undefined) => R | Promise<R>,
): Promise<R>;
export async function writeFileThenDb<T, R>(
  fileOps: () => Promise<FileOpResult<T>>,
  dbOp: (result: T | undefined) => R | Promise<R>,
): Promise<R> {
  const { writtenFiles, result } = normalizeFileOpResult(await fileOps());

  try {
    return await dbOp(result);
  } catch (error) {
    await Promise.allSettled(
      writtenFiles.map(async (filePath) => {
        await unlink(filePath).catch(() => undefined); // best-effort cleanup; original error is re-thrown below
      }),
    );
    throw error;
  }
}

/**
 * 先执行 DB 操作，再写镜像文件。
 * 文件失败时不回滚 DB，交由调用方记录告警。
 */
export async function writeDbThenFile<T>(
  dbOp: () => T | Promise<T>,
  fileOps: (result: T) => Promise<void>,
  onFileError?: (error: unknown) => void,
): Promise<T> {
  const result = await dbOp();

  try {
    await fileOps(result);
  } catch (error) {
    if (onFileError) {
      onFileError(error);
    } else {
      throw error;
    }
  }

  return result;
}
