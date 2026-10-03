import { SelectTool } from './selectTool.js';
import { WallTool } from './wallTool.js';
import { OpeningTool } from './openingTool.js';
import { FloorTool } from './floorTool.js';
import { ColumnTool, RoomTool, GridTool } from './placeTools.js';

export function createTools(app) {
  return {
    select: new SelectTool(app),
    wall: new WallTool(app),
    door: new OpeningTool(app, 'Door'),
    window: new OpeningTool(app, 'Window'),
    floor: new FloorTool(app),
    column: new ColumnTool(app),
    room: new RoomTool(app),
    grid: new GridTool(app),
  };
}
