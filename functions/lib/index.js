"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listBoards = exports.deleteBoard = exports.updateBoard = exports.getBoard = exports.createBoard = void 0;
const app_1 = require("firebase-admin/app");
// Initialize Firebase Admin
(0, app_1.initializeApp)();
// Export all functions
var boards_1 = require("./api/boards");
Object.defineProperty(exports, "createBoard", { enumerable: true, get: function () { return boards_1.createBoard; } });
Object.defineProperty(exports, "getBoard", { enumerable: true, get: function () { return boards_1.getBoard; } });
Object.defineProperty(exports, "updateBoard", { enumerable: true, get: function () { return boards_1.updateBoard; } });
Object.defineProperty(exports, "deleteBoard", { enumerable: true, get: function () { return boards_1.deleteBoard; } });
Object.defineProperty(exports, "listBoards", { enumerable: true, get: function () { return boards_1.listBoards; } });
//# sourceMappingURL=index.js.map