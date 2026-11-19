import baseConfig from "@uo3/config/eslint/base";
import boundariesConfig from "@uo3/config/eslint/boundaries";
import browserConfig from "@uo3/config/eslint/browser";
import serverConfig from "@uo3/config/eslint/server";

export default [...baseConfig, ...browserConfig, ...serverConfig, ...boundariesConfig];
