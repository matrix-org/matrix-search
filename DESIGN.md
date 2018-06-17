# Design

Due to the requirements this system will have two modes:
+ ~~Appservice mode~~ AS mode at this time will not be continued
+ Local Daemon mode

# Appservice mode
The system receives events via the AS Transactions Push, indexes them and acts as a Synapse/HS worker for /search.
In this mode it will not be possible to E2E-search, as that would mean sending keys to a potentially untrusted server.
This mode is intended to alleviate load from Synapse and other homeservers in scenarios where the native Full Text search is too slow.

In this mode, due to ACLs, it might be easier to move the resolving of the events back to Synapse, such that this only passes Synapse event IDs.

```
+------------+          |  +-------------+   AS Push    +-------------------+
|            | /search  |  |             | ===========> |                   |
|   Client   | ==========> |   Synapse   |              |   matrix-search   |
|            |  CS-API  |  |             | <==========> |                   |
+------------+          |  +-------------+ /search jobs +-------------------+
                        |
                `Local` | `Remote` 
```

# Local Daemon mode
The system performs syncs via the CS API, indexes all new events and would let clients share E2E keys with it so that it can be used to index E2E rooms.

In this mode, the indexes can never hold events which we don't have access to so we can store them locally in a lookup table.

```
+------------+          |  +-------------+
|            |          |  |             |
|   Client   | ==========> |   Synapse   |
|            |  CS-API  |  |             |
+------------+          |  +-------------+
   /\                   |    ^
   || /search           |    ‖
   \/                   |    ‖ /sync and
+-------------------+   |    ‖ /messages
|                   |   |    ‖  CS-API
|   matrix-search   |   |    ‖
|                   |   |    ‖
+-------------------+   |    ‖
                        |    ‖
+-------------------+   |    ‖
|   _js_fetcher     | =======/
+-------------------+   |
                        
                `Local` | `Remote` 
```

The Daemon could also be extended for further functionality, such as abstracting all E2E and providing an even simpler API for local clients to use, or buffering /sync requests such that it can serve room history from a local store, speeding up the frontend client performance.