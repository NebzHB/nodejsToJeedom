# Usage

const jsend = require('./utils/jeedom.js')('idPlugin',conf.urlJeedom,conf.apiKey,conf.logLevel,conf.mode);

conf.urlJeedom = "http://JEEDOM_IP/core/api/jeeApi.php"

conf.apiKey = jeedom api key

conf.logLevel = "debug" or else

confi.mode could be "jsonrpc" or "event"


then 

jsend({eventType: 'pairedEq', result:'ok', id: req.query.id});

if the lib uses jsonrpc, so need a redirect to event method :

in core/api/idplugin.api.php :

```

header('Content-Type: application/json');

require_once dirname(__FILE__) . "/../../../../core/php/core.inc.php";

global $jsonrpc;
if (!is_object($jsonrpc)) {
	throw new Exception(__('JSONRPC object not defined', __FILE__), -32699);
}

$params = $jsonrpc->getParams();

if (!jeedom::apiAccess($params['apikey'], 'idPlugin')) {
    $error=__("Clef API non valide, vous n'êtes pas autorisé à effectuer cette action (idPlugin)", __FILE__);
	echo $error;
	log::add('idPlugin', 'error', $error);
    die();
}

if ($jsonrpc->getMethod() == 'event') {
	idPlugin::event($params['data']);
	$jsonrpc->makeSuccess(true);
}

throw new Exception(__('Aucune demande', __FILE__));
```
