/** One area is a self-contained walkable space with its own coordinate system. */
export interface Rect { x: number; y: number; width: number; height: number }
export interface Furniture extends Rect { kind: 'desk' | 'table' | 'shelf' | 'counter' | 'sofa' | 'plant' }
/** Widened to 'corridor' | 'meeting' | 'storage' when the room areas land. */
export type AreaId = 'corridor';
export interface Exit {
  rect: Rect;                      // 触发器，玩家中心落入即触发
  to: AreaId;
  at: { x: number; y: number };    // 目标 area 内的落点
  label: string;                   // 玩家可见名字，用于封闭提示
  locked?: boolean;
}
export interface Area {
  id: AreaId;
  name: string;
  width: number; height: number;
  bounds: Rect;                    // 可行走的外框（外墙内侧）
  radius: number;                  // 角色碰撞半径
  speed: number;                   // 世界像素 / 秒
  spawnPoints: { x: number; y: number }[];
  walls: Rect[];
  furniture: Furniture[];
  obstacles: Rect[];               // walls + furniture + 不可达区域
  exits: Exit[];
}
