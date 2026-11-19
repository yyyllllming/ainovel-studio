import type { Meta, StoryObj } from '@storybook/react';
import { FoundationWorkshopClient } from './foundation-workshop-client';

const meta = {
  title: 'Components/FoundationWorkshopClient',
  component: FoundationWorkshopClient,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof FoundationWorkshopClient>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    projectId: 'demo-project-001',
    foundation: null,
    foundationLocked: false,
    sourceIdea: null,
  },
};

export const WithFoundation: Story = {
  args: {
    projectId: 'demo-project-002',
    foundation: {
      premise: '一个关于时间旅行的科幻故事',
      styleCard: '硬核科幻风格，注重科学细节和逻辑推理',
      characters: [
        {
          name: '李明',
          role: '物理学家',
          goal: '揭开时间旅行的秘密',
          traits: ['聪明', '执着', '理性'],
        },
        {
          name: '王芳',
          role: '助手',
          goal: '协助李明完成研究',
          traits: ['细心', '勇敢', '忠诚'],
        },
      ],
      worldview: [
        {
          name: '时间悖论',
          description: '改变过去会导致时间线分裂',
        },
      ],
      relationships: [
        {
          source: '李明',
          target: '王芳',
          label: '师徒关系',
        },
      ],
    },
    foundationLocked: false,
    sourceIdea: {
      id: 'idea-001',
      title: '时间旅行实验',
      deletedAt: null,
      updatedAt: '2026-04-12T10:00:00Z',
      draft: null,
    },
  },
};

export const Locked: Story = {
  args: {
    projectId: 'demo-project-003',
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
    sourceIdea: null,
  },
};
