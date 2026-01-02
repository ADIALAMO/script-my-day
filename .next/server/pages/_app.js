/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(() => {
var exports = {};
exports.id = "pages/_app";
exports.ids = ["pages/_app"];
exports.modules = {

/***/ "(pages-dir-node)/./pages/_app.js":
/*!***********************!*\
  !*** ./pages/_app.js ***!
  \***********************/
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": () => (__WEBPACK_DEFAULT_EXPORT__)\n/* harmony export */ });\n/* harmony import */ var react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react/jsx-dev-runtime */ \"react/jsx-dev-runtime\");\n/* harmony import */ var _styles_globals_css__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../styles/globals.css */ \"(pages-dir-node)/./styles/globals.css\");\n/* harmony import */ var next_head__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! next/head */ \"(pages-dir-node)/./node_modules/next/head.js\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! react */ \"react\");\n// pages/_app.js\n\n\n\n\nfunction MyApp({ Component, pageProps }) {\n    (0,react__WEBPACK_IMPORTED_MODULE_3__.useEffect)({\n        \"MyApp.useEffect\": ()=>{\n            // טריק קטן עבורך, הבמאי:\n            // אם תיכנס לאתר שלך ותוסיף בסוף הכתובת ?admin=true\n            // (לדוגמה: lifescript.co.il?admin=true)\n            // המכשיר שלך יירשם אוטומטית כמנהל ולא תצטרך לפתוח Console.\n            const urlParams = new URLSearchParams(window.location.search);\n            if (urlParams.get('admin') === 'true') {\n                localStorage.setItem('lifescript_admin_key', 'LifeScript_Admin_2025_Success');\n                console.log(\"Admin mode activated on this device!\");\n                // מנקה את הכתובת כדי שזה יראה נקי\n                window.history.replaceState({}, document.title, window.location.pathname);\n            }\n        }\n    }[\"MyApp.useEffect\"], []);\n    return /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.Fragment, {\n        children: [\n            /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(next_head__WEBPACK_IMPORTED_MODULE_2__, {\n                children: [\n                    /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"title\", {\n                        children: \"LIFESCRIPT STUDIO\"\n                    }, void 0, false, {\n                        fileName: \"/Users/dylmw/my-life-script/pages/_app.js\",\n                        lineNumber: 25,\n                        columnNumber: 9\n                    }, this),\n                    /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"meta\", {\n                        name: \"viewport\",\n                        content: \"width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0, viewport-fit=cover\"\n                    }, void 0, false, {\n                        fileName: \"/Users/dylmw/my-life-script/pages/_app.js\",\n                        lineNumber: 27,\n                        columnNumber: 9\n                    }, this),\n                    /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"meta\", {\n                        name: \"theme-color\",\n                        content: \"#0a0a0a\"\n                    }, void 0, false, {\n                        fileName: \"/Users/dylmw/my-life-script/pages/_app.js\",\n                        lineNumber: 31,\n                        columnNumber: 9\n                    }, this),\n                    /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"meta\", {\n                        name: \"apple-mobile-web-app-capable\",\n                        content: \"yes\"\n                    }, void 0, false, {\n                        fileName: \"/Users/dylmw/my-life-script/pages/_app.js\",\n                        lineNumber: 32,\n                        columnNumber: 9\n                    }, this),\n                    /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"meta\", {\n                        name: \"apple-mobile-web-app-status-bar-style\",\n                        content: \"black-translucent\"\n                    }, void 0, false, {\n                        fileName: \"/Users/dylmw/my-life-script/pages/_app.js\",\n                        lineNumber: 33,\n                        columnNumber: 9\n                    }, this),\n                    /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"link\", {\n                        rel: \"icon\",\n                        href: \"/favicon.ico\"\n                    }, void 0, false, {\n                        fileName: \"/Users/dylmw/my-life-script/pages/_app.js\",\n                        lineNumber: 34,\n                        columnNumber: 9\n                    }, this)\n                ]\n            }, void 0, true, {\n                fileName: \"/Users/dylmw/my-life-script/pages/_app.js\",\n                lineNumber: 24,\n                columnNumber: 7\n            }, this),\n            /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"main\", {\n                className: \"min-h-screen bg-[#0a0a0a] selection:bg-[#d4a373]/30\",\n                children: /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(Component, {\n                    ...pageProps\n                }, void 0, false, {\n                    fileName: \"/Users/dylmw/my-life-script/pages/_app.js\",\n                    lineNumber: 38,\n                    columnNumber: 9\n                }, this)\n            }, void 0, false, {\n                fileName: \"/Users/dylmw/my-life-script/pages/_app.js\",\n                lineNumber: 37,\n                columnNumber: 7\n            }, this)\n        ]\n    }, void 0, true);\n}\n/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (MyApp);\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHBhZ2VzLWRpci1ub2RlKS8uL3BhZ2VzL19hcHAuanMiLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7QUFBQSxnQkFBZ0I7O0FBQ2U7QUFDRjtBQUNLO0FBRWxDLFNBQVNFLE1BQU0sRUFBRUMsU0FBUyxFQUFFQyxTQUFTLEVBQUU7SUFFckNILGdEQUFTQTsyQkFBQztZQUNSLHlCQUF5QjtZQUN6QixtREFBbUQ7WUFDbkQsd0NBQXdDO1lBQ3hDLDJEQUEyRDtZQUMzRCxNQUFNSSxZQUFZLElBQUlDLGdCQUFnQkMsT0FBT0MsUUFBUSxDQUFDQyxNQUFNO1lBQzVELElBQUlKLFVBQVVLLEdBQUcsQ0FBQyxhQUFhLFFBQVE7Z0JBQ3JDQyxhQUFhQyxPQUFPLENBQUMsd0JBQXdCO2dCQUM3Q0MsUUFBUUMsR0FBRyxDQUFDO2dCQUNaLGtDQUFrQztnQkFDbENQLE9BQU9RLE9BQU8sQ0FBQ0MsWUFBWSxDQUFDLENBQUMsR0FBR0MsU0FBU0MsS0FBSyxFQUFFWCxPQUFPQyxRQUFRLENBQUNXLFFBQVE7WUFDMUU7UUFDRjswQkFBRyxFQUFFO0lBRUwscUJBQ0U7OzBCQUNFLDhEQUFDbkIsc0NBQUlBOztrQ0FDSCw4REFBQ2tCO2tDQUFNOzs7Ozs7a0NBRVAsOERBQUNFO3dCQUNDQyxNQUFLO3dCQUNMQyxTQUFROzs7Ozs7a0NBRVYsOERBQUNGO3dCQUFLQyxNQUFLO3dCQUFjQyxTQUFROzs7Ozs7a0NBQ2pDLDhEQUFDRjt3QkFBS0MsTUFBSzt3QkFBK0JDLFNBQVE7Ozs7OztrQ0FDbEQsOERBQUNGO3dCQUFLQyxNQUFLO3dCQUF3Q0MsU0FBUTs7Ozs7O2tDQUMzRCw4REFBQ0M7d0JBQUtDLEtBQUk7d0JBQU9DLE1BQUs7Ozs7Ozs7Ozs7OzswQkFHeEIsOERBQUNDO2dCQUFLQyxXQUFVOzBCQUNkLDRFQUFDeEI7b0JBQVcsR0FBR0MsU0FBUzs7Ozs7Ozs7Ozs7OztBQUloQztBQUVBLGlFQUFlRixLQUFLQSxFQUFDIiwic291cmNlcyI6WyIvVXNlcnMvZHlsbXcvbXktbGlmZS1zY3JpcHQvcGFnZXMvX2FwcC5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBwYWdlcy9fYXBwLmpzXG5pbXBvcnQgJy4uL3N0eWxlcy9nbG9iYWxzLmNzcyc7XG5pbXBvcnQgSGVhZCBmcm9tICduZXh0L2hlYWQnO1xuaW1wb3J0IHsgdXNlRWZmZWN0IH0gZnJvbSAncmVhY3QnO1xuXG5mdW5jdGlvbiBNeUFwcCh7IENvbXBvbmVudCwgcGFnZVByb3BzIH0pIHtcbiAgXG4gIHVzZUVmZmVjdCgoKSA9PiB7XG4gICAgLy8g15jXqNeZ16cg16fXmNefINei15HXldeo15osINeU15HXnteQ15k6XG4gICAgLy8g15DXnSDXqteZ15vXoNehINec15DXqteoINep15zXmiDXldeq15XXodeZ16Mg15HXodeV16Mg15TXm9eq15XXkdeqID9hZG1pbj10cnVlXG4gICAgLy8gKNec15PXldeS157XlDogbGlmZXNjcmlwdC5jby5pbD9hZG1pbj10cnVlKVxuICAgIC8vINeU157Xm9ep15nXqCDXqdec15og15nXmdeo16nXnSDXkNeV15jXldee15jXmdeqINeb157XoNeU15wg15XXnNeQINeq16bXmNeo15og15zXpNeq15XXlyBDb25zb2xlLlxuICAgIGNvbnN0IHVybFBhcmFtcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMod2luZG93LmxvY2F0aW9uLnNlYXJjaCk7XG4gICAgaWYgKHVybFBhcmFtcy5nZXQoJ2FkbWluJykgPT09ICd0cnVlJykge1xuICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oJ2xpZmVzY3JpcHRfYWRtaW5fa2V5JywgJ0xpZmVTY3JpcHRfQWRtaW5fMjAyNV9TdWNjZXNzJyk7XG4gICAgICBjb25zb2xlLmxvZyhcIkFkbWluIG1vZGUgYWN0aXZhdGVkIG9uIHRoaXMgZGV2aWNlIVwiKTtcbiAgICAgIC8vINee16DXp9eUINeQ16og15TXm9eq15XXkdeqINeb15PXmSDXqdeW15Qg15nXqNeQ15Qg16DXp9eZXG4gICAgICB3aW5kb3cuaGlzdG9yeS5yZXBsYWNlU3RhdGUoe30sIGRvY3VtZW50LnRpdGxlLCB3aW5kb3cubG9jYXRpb24ucGF0aG5hbWUpO1xuICAgIH1cbiAgfSwgW10pO1xuXG4gIHJldHVybiAoXG4gICAgPD5cbiAgICAgIDxIZWFkPlxuICAgICAgICA8dGl0bGU+TElGRVNDUklQVCBTVFVESU88L3RpdGxlPlxuICAgICAgICB7Lyog15DXldek15jXmdee15nXltem15nXlCDXnNee15XXkdeZ15nXnCAtINee15HXmNeZ15cg16nXqdeV150g15PXkdeoINec15Ag15nXl9eq15XXmiDXkNeqINeULVVJICovfVxuICAgICAgICA8bWV0YSBcbiAgICAgICAgICBuYW1lPVwidmlld3BvcnRcIiBcbiAgICAgICAgICBjb250ZW50PVwid2lkdGg9ZGV2aWNlLXdpZHRoLCBpbml0aWFsLXNjYWxlPTEsIG1heGltdW0tc2NhbGU9MSwgdXNlci1zY2FsYWJsZT0wLCB2aWV3cG9ydC1maXQ9Y292ZXJcIiBcbiAgICAgICAgLz5cbiAgICAgICAgPG1ldGEgbmFtZT1cInRoZW1lLWNvbG9yXCIgY29udGVudD1cIiMwYTBhMGFcIiAvPlxuICAgICAgICA8bWV0YSBuYW1lPVwiYXBwbGUtbW9iaWxlLXdlYi1hcHAtY2FwYWJsZVwiIGNvbnRlbnQ9XCJ5ZXNcIiAvPlxuICAgICAgICA8bWV0YSBuYW1lPVwiYXBwbGUtbW9iaWxlLXdlYi1hcHAtc3RhdHVzLWJhci1zdHlsZVwiIGNvbnRlbnQ9XCJibGFjay10cmFuc2x1Y2VudFwiIC8+XG4gICAgICAgIDxsaW5rIHJlbD1cImljb25cIiBocmVmPVwiL2Zhdmljb24uaWNvXCIgLz5cbiAgICAgIDwvSGVhZD5cbiAgICAgIFxuICAgICAgPG1haW4gY2xhc3NOYW1lPVwibWluLWgtc2NyZWVuIGJnLVsjMGEwYTBhXSBzZWxlY3Rpb246YmctWyNkNGEzNzNdLzMwXCI+XG4gICAgICAgIDxDb21wb25lbnQgey4uLnBhZ2VQcm9wc30gLz5cbiAgICAgIDwvbWFpbj5cbiAgICA8Lz5cbiAgKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgTXlBcHA7Il0sIm5hbWVzIjpbIkhlYWQiLCJ1c2VFZmZlY3QiLCJNeUFwcCIsIkNvbXBvbmVudCIsInBhZ2VQcm9wcyIsInVybFBhcmFtcyIsIlVSTFNlYXJjaFBhcmFtcyIsIndpbmRvdyIsImxvY2F0aW9uIiwic2VhcmNoIiwiZ2V0IiwibG9jYWxTdG9yYWdlIiwic2V0SXRlbSIsImNvbnNvbGUiLCJsb2ciLCJoaXN0b3J5IiwicmVwbGFjZVN0YXRlIiwiZG9jdW1lbnQiLCJ0aXRsZSIsInBhdGhuYW1lIiwibWV0YSIsIm5hbWUiLCJjb250ZW50IiwibGluayIsInJlbCIsImhyZWYiLCJtYWluIiwiY2xhc3NOYW1lIl0sImlnbm9yZUxpc3QiOltdLCJzb3VyY2VSb290IjoiIn0=\n//# sourceURL=webpack-internal:///(pages-dir-node)/./pages/_app.js\n");

/***/ }),

/***/ "(pages-dir-node)/./styles/globals.css":
/*!****************************!*\
  !*** ./styles/globals.css ***!
  \****************************/
/***/ (() => {



/***/ }),

/***/ "next/dist/compiled/next-server/pages.runtime.dev.js":
/*!**********************************************************************!*\
  !*** external "next/dist/compiled/next-server/pages.runtime.dev.js" ***!
  \**********************************************************************/
/***/ ((module) => {

"use strict";
module.exports = require("next/dist/compiled/next-server/pages.runtime.dev.js");

/***/ }),

/***/ "react":
/*!************************!*\
  !*** external "react" ***!
  \************************/
/***/ ((module) => {

"use strict";
module.exports = require("react");

/***/ }),

/***/ "react/jsx-dev-runtime":
/*!****************************************!*\
  !*** external "react/jsx-dev-runtime" ***!
  \****************************************/
/***/ ((module) => {

"use strict";
module.exports = require("react/jsx-dev-runtime");

/***/ }),

/***/ "react/jsx-runtime":
/*!************************************!*\
  !*** external "react/jsx-runtime" ***!
  \************************************/
/***/ ((module) => {

"use strict";
module.exports = require("react/jsx-runtime");

/***/ })

};
;

// load runtime
var __webpack_require__ = require("../webpack-runtime.js");
__webpack_require__.C(exports);
var __webpack_exec__ = (moduleId) => (__webpack_require__(__webpack_require__.s = moduleId))
var __webpack_exports__ = __webpack_require__.X(0, ["vendor-chunks/next","vendor-chunks/@swc"], () => (__webpack_exec__("(pages-dir-node)/./pages/_app.js")));
module.exports = __webpack_exports__;

})();