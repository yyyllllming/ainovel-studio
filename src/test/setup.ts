import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, vi } from "vitest";

export const routerPushMock = vi.fn();
export const routerRefreshMock = vi.fn();
export const routerReplaceMock = vi.fn();
let pathnameMock = "/projects";
let searchParamsMock = new URLSearchParams();

export function setPathnameMock(pathname: string) {
  pathnameMock = pathname;
}

export function setSearchParamsMock(input: string | URLSearchParams) {
  searchParamsMock = new URLSearchParams(
    typeof input === "string" ? input : input.toString(),
  );
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
    refresh: routerRefreshMock,
    replace: routerReplaceMock,
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => pathnameMock,
  useSearchParams: () => searchParamsMock,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href, ...props }, children),
}));

vi.mock("next/dynamic", () => ({
  default: (
    _loader: unknown,
    options?: {
      loading?: () => React.ReactNode;
    },
  ) => {
    const DynamicComponent = (props: Record<string, unknown>) =>
      options?.loading
        ? React.createElement(React.Fragment, null, options.loading())
        : React.createElement("div", { "data-testid": "dynamic-component", ...props });
    DynamicComponent.displayName = "NextDynamicMock";
    return DynamicComponent;
  },
}));

if (!globalThis.ResizeObserver) {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    value: ResizeObserverMock,
  });
}

if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

afterEach(() => {
  cleanup();
  routerPushMock.mockReset();
  routerRefreshMock.mockReset();
  routerReplaceMock.mockReset();
  pathnameMock = "/projects";
  searchParamsMock = new URLSearchParams();
  window.localStorage.clear();
  vi.clearAllMocks();
});
