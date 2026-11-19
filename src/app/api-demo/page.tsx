"use client";

import { useState } from "react";
import { BookOpen, FileCode, Folder, Settings, Server } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";

type ApiEndpoints = "projects" | "chapters" | "profiles" | "api-docs";

interface ApiResponse {
  [key: string]: unknown;
}

export default function ApiDemoPage() {
  const [selectedEndpoint, setSelectedEndpoint] = useState<ApiEndpoints | null>(null);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endpoints = [
    {
      id: "projects",
      name: "项目列表",
      icon: Folder,
      description: "获取所有项目的列表",
      method: "GET",
    },
    {
      id: "chapters",
      name: "章节列表",
      icon: BookOpen,
      description: "获取项目的章节列表",
      method: "GET",
    },
    {
      id: "profiles",
      name: "LLM 配置",
      icon: Settings,
      description: "获取语言模型配置文件",
      method: "GET",
    },
    {
      id: "api-docs",
      name: "API 文档",
      icon: FileCode,
      description: "获取 API 接口文档",
      method: "GET",
    },
  ];

  const fetchData = async (endpoint: ApiEndpoints) => {
    setLoading(true);
    setError(null);
    try {
      let data;
      if (endpoint === "chapters") {
        data = await apiGet<ApiResponse>(`/api/demo?endpoint=${endpoint}&projectId=proj_123`);
      } else {
        data = await apiGet<ApiResponse>(`/api/demo?endpoint=${endpoint}`);
      }
      setResponse(data);
      setSelectedEndpoint(endpoint);
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败");
    } finally {
      setLoading(false);
    }
  };

  const createProject = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiPost<ApiResponse>("/api/demo?endpoint=create-project", {
        title: "新小说项目",
        genre: "现代悬疑",
        premise: "一个关于真相与谎言的故事",
        storyLength: "long",
        seriesMode: "standalone",
      });
      setResponse(data);
      setSelectedEndpoint(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败");
    } finally {
      setLoading(false);
    }
  };

  const formatResponse = (data: ApiResponse) => {
    return JSON.stringify(data, null, 2);
  };

  return (
    <div className="min-h-screen bg-[var(--surface)]">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Server className="h-8 w-8 text-[var(--accent)]" />
            <h1 className="text-3xl font-bold text-[var(--ink)]">API 演示</h1>
          </div>
          <p className="text-[var(--ink-soft)]">后端接口演示页面</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* 左侧面板：API 端点 */}
          <div className="lg:col-span-1">
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)] mb-4">API 端点</h2>
                <div className="space-y-2">
                  {endpoints.map((endpoint) => (
                    <button
                      key={endpoint.id}
                      onClick={() => fetchData(endpoint.id as ApiEndpoints)}
                      disabled={loading}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border transition-all ${
                        selectedEndpoint === endpoint.id
                          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                          : "border-[var(--line)] bg-[var(--panel-soft)] hover:bg-[var(--hover)]"
                      } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <endpoint.icon className="h-5 w-5 flex-shrink-0" />
                      <div className="text-left">
                        <p className="font-medium">{endpoint.name}</p>
                        <p className="text-sm text-[var(--ink-soft)]">{endpoint.description}</p>
                      </div>
                      <span className={`text-xs font-mono px-2 py-1 rounded ${
                        endpoint.method === "GET"
                          ? "bg-emerald-500/15 text-emerald-200"
                          : "bg-sky-500/15 text-sky-200"
                      }`}>
                        {endpoint.method}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-[var(--line)] pt-4">
                <h3 className="text-sm font-semibold text-[var(--ink)] mb-3">操作演示</h3>
                <button
                  onClick={createProject}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90 disabled:opacity-50 transition-colors"
                >
                  <Folder className="h-5 w-5" />
                  <span>创建新项目</span>
                </button>
              </div>
            </div>
          </div>

          {/* 右侧面板：响应展示 */}
          <div className="lg:col-span-2">
            <div className="border border-[var(--line)] bg-[var(--panel-soft)] rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)]">
                <h2 className="text-lg font-semibold text-[var(--ink)]">
                  API 响应
                </h2>
                {selectedEndpoint && (
                  <span className="text-sm text-[var(--ink-soft)]">
                    Endpoint: /api/demo?endpoint={selectedEndpoint}
                  </span>
                )}
              </div>

              <div className="p-6 min-h-[400px]">
                {loading ? (
                  <div className="flex flex-col items-center justify-center h-full text-[var(--ink-soft)]">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)] mb-3"></div>
                    <p>请求中...</p>
                  </div>
                ) : error ? (
                  <div className="text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">
                    <p className="font-medium mb-1">请求失败</p>
                    <p className="text-sm">{error}</p>
                  </div>
                ) : response ? (
                  <div className="relative">
                    <div className="absolute top-2 right-2">
                      <button
                        onClick={() => navigator.clipboard.writeText(formatResponse(response))}
                        className="px-3 py-1 text-xs bg-[var(--surface-soft)] rounded hover:bg-[var(--surface-deep)] transition-colors"
                      >
                        复制
                      </button>
                    </div>
                    <pre className="bg-[var(--surface-soft)] p-4 rounded-lg text-sm overflow-x-auto font-mono text-[var(--ink)] max-h-[600px] overflow-y-auto">
                      {formatResponse(response)}
                    </pre>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-[var(--ink-soft)]">
                    <Server className="h-12 w-12 mb-4 opacity-50" />
                    <p className="text-lg font-medium mb-2">请选择 API 端点</p>
                    <p className="text-sm text-center max-w-md">
                      在左侧选择一个 API 端点来查看响应。此页面展示了当前项目后端 API 的实际响应格式。
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* 技术信息 */}
            <div className="mt-6 bg-[var(--surface-soft)] rounded-lg p-6">
              <h3 className="text-sm font-semibold text-[var(--ink)] mb-3">技术信息</h3>
              <div className="space-y-2 text-sm text-[var(--ink-soft)]">
                <p>• 后端框架: Next.js 16</p>
                <p>• 数据库: SQLite + Drizzle ORM</p>
                <p>• API 格式: RESTful JSON</p>
                <p>• 状态码: 200 (成功), 400 (参数错误), 404 (资源不存在)</p>
                <p className="mt-4 text-xs text-[var(--ink-softer)]">
                  注意：此页面使用模拟数据。真实数据需要启动开发服务器。
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
