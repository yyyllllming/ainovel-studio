import type { Meta, StoryObj } from '@storybook/react';
import { ProjectDetailClient } from './project-detail-client';

const meta = {
  title: 'Components/ProjectDetailClient',
  component: ProjectDetailClient,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ProjectDetailClient>;

export default meta;
type Story = StoryObj<typeof meta>;

const mockProject = {
  id: 'demo-project-001',
  title: '时间旅行实验',
  genre: '科幻',
  style: '硬核科幻',
  targetChapters: 10,
  premise: '一个关于时间旅行的故事',
  seriesMode: 'standalone' as const,
  seriesTitle: null,
  seriesIndex: null,
  storyLength: 'short' as const,
  narrativePerson: 'third' as const,
  chapterPlanningMode: 'fixed' as const,
  paceProfile: 'medium' as const,
  completionCriteria: '',
  chapterBudgetMin: 2000,
  chapterBudgetTarget: 3000,
  chapterBudgetMax: 4000,
  hardChapterCap: 10,
  reviewPolicy: {
    cadenceChapters: 3,
    deepReviewStartChapter: 1,
    perChapterCheckMode: 'minimal' as const,
    forceTriggers: ['cadence' as const],
    manualCheckpointChapters: [],
  },
  hasVolumes: false,
  plannedVolumes: null,
  sourceIdeaId: null,
  storyContract: null,
  steeringNotes: [],
  status: 'active',
  deletedAt: null,
  createdAt: '2026-04-12T10:00:00Z',
  updatedAt: '2026-04-12T10:00:00Z',
};

const mockProgress = {
  running: false,
  stage: 'idle' as const,
  currentChapter: 0,
  totalChapters: 10,
  retryCount: 0,
  confidence: 0,
  stageDetails: {},
  logs: [],
};

const mockProfiles = {
  profiles: [
    {
      id: 'profile-001',
      name: 'GPT-4',
      providerId: 'openai',
      protocol: 'openai_compatible' as const,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '***',
      defaultModel: 'gpt-4',
      enabled: true,
      createdAt: '2026-04-12T10:00:00Z',
      updatedAt: '2026-04-12T10:00:00Z',
    },
  ],
};

export const Default: Story = {
  args: {
    projectId: 'demo-project-001',
    initialSnapshot: {
      project: mockProject,
      storyContract: null,
      steeringNotes: [],
      resolvedReviewPolicy: mockProject.reviewPolicy,
      assignments: [],
      foundation: null,
      foundationLocked: false,
      foundationWorkshop: null,
      runState: null,
      blueprints: [],
      recentReviews: [],
      reviewStates: [],
      invalidatedHistory: [],
      conflicts: [],
      logs: [],
      sourceIdea: null,
      novelExport: {
        exists: false,
        status: 'pending',
      },
      writtenChapters: [],
    },
    initialProgress: mockProgress,
    initialProfiles: mockProfiles,
    initialCards: {
      cards: [],
      candidateCount: 0,
    },
  },
};

export const WithFoundation: Story = {
  args: {
    ...Default.args,
    initialSnapshot: {
      ...Default.args!.initialSnapshot!,
      foundation: {
        premise: '一个关于时间旅行的科幻故事',
        styleCard: '硬核科幻风格',
        characters: [
          {
            name: '李明',
            role: '物理学家',
            goal: '揭开时间旅行的秘密',
            traits: ['聪明', '执着'],
          },
        ],
        worldview: [],
        relationships: [],
      },
      foundationLocked: true,
    },
  },
};

export const Running: Story = {
  args: {
    ...Default.args,
    initialProgress: {
      running: true,
      stage: 'writing' as const,
      currentChapter: 3,
      totalChapters: 10,
      retryCount: 0,
      confidence: 0.85,
      stageDetails: {},
      logs: [
        {
          level: 'info',
          message: '开始写作第 3 章',
          createdAt: '2026-04-12T10:00:00Z',
        },
      ],
    },
  },
};
