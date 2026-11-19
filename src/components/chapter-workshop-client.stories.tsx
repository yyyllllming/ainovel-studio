import type { Meta, StoryObj } from '@storybook/react';
import { ChapterWorkshopClient } from './chapter-workshop-client';

const meta = {
  title: 'Components/ChapterWorkshopClient',
  component: ChapterWorkshopClient,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ChapterWorkshopClient>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    projectId: 'demo-project-001',
    chapterNo: 1,
  },
};

export const WithBlueprint: Story = {
  args: {
    projectId: 'demo-project-002',
    chapterNo: 1,
  },
};

export const WithContent: Story = {
  args: {
    projectId: 'demo-project-003',
    chapterNo: 1,
  },
};

export const WithReview: Story = {
  args: {
    projectId: 'demo-project-004',
    chapterNo: 1,
  },
};

export const ManualReview: Story = {
  args: {
    projectId: 'demo-project-005',
    chapterNo: 1,
  },
};
