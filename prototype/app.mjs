import {createShell} from './shell-app.mjs';
import {createDemoContext} from './session.mjs';
createShell(createDemoContext(new URLSearchParams(location.search).get('fixture')||'normal'));
