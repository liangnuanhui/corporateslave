export interface Site { id: string; name: string; detail: string; x: number; y: number; open: boolean }
/** x / y are percentages on the map panel, so the layout is resolution independent. */
export const SITES: Site[] = [
  { id: 'hangzhou', name: '杭州总部', detail: '摸鱼科技 · 1F', x: 62, y: 52, open: true },
  { id: 'beijing', name: '北京分部', detail: '筹备中', x: 55, y: 24, open: false },
  { id: 'shenzhen', name: '深圳分部', detail: '筹备中', x: 57, y: 79, open: false },
];
