# Spec 001 — Base de datos Supabase y panel de administración
Estado: aprobada

## Contexto y objetivo

VentasCel es una tienda online estática (un único documento HTML con su CSS y su JavaScript en línea) publicada en GitHub Pages. El catálogo de productos vive hoy en un fichero maestro dentro del repositorio, y el panel de administración que acompaña a la tienda funciona así:

- **El acceso no está protegido de verdad.** El panel se abre con una contraseña que el navegador compara contra un hash SHA-256 incrustado en el propio código publicado. Como el repositorio es público, cualquiera que lo lea puede deducir el acceso y tomar el control del catálogo.
- **Los cambios no se guardan en ningún servidor.** El panel solo escribe en el almacenamiento local del navegador. Para que un cambio se viera online había que descargar a mano el fichero del catálogo, sustituirlo en el repositorio y subirlo.
- **El proyecto ya tiene un servicio de base de datos creado y vacío**, con autenticación y almacenamiento de archivos disponibles, pero sin tablas, sin datos y sin bucket de imágenes.
- **El catálogo maestro y la semilla que viaja con el sitio no están sincronizados.** El maestro tiene 75 productos (identificadores 1..75, versión 26); la semilla incluida en el sitio se quedó atrás, con 54 productos (54 imágenes en la carpeta del repositorio y 21 embebidas en base64).

El objetivo de esta spec es **dotar a VentasCel de una base de datos real y conectar el panel de administración de verdad**: que el acceso al panel se valide contra el servicio de identidad en lugar de contra un hash incrustado en el cliente, que el alta, la edición y la baja de productos se persistan en la base de datos, y que el catálogo publicado deje de depender de los ficheros estáticos del repositorio, de modo que el catálogo deje de depender de descargas y pushes manuales.

El resultado buscado: una tienda cuyo catálogo se gobierna desde un panel seguro y cuyos cambios se publican sin intervención manual, sin perder nada de lo que ya funciona y sin convertir el proyecto en otra cosa.

## Usuarios

- **Visitante**: persona que abre la tienda sin cuenta. Navega el catálogo, filtra, busca, usa favoritos, añade al carrito y cierra el pedido por WhatsApp.
- **Administrador**: persona con el rol de administrador, autorizada a gestionar el catálogo. Puede haber varias cuentas con ese rol, todas dadas de alta fuera de la tienda con la credencial privilegiada; cada una entra al panel con su correo y su contraseña.

## Historias de usuario

- HU-1. Como visitante, quiero ver el catálogo que publica el administrador, con su precio en CUP y su equivalente en dólares, para que la tienda refleje la disponibilidad y el precio real sin esperar a un despliegue.
- HU-2. Como visitante, quiero ver el catálogo aunque la base de datos no responda, con un aviso único y sin perder nada de lo que tengo guardado en el navegador, para no encontrarme una tienda en blanco.
- HU-3. Como visitante, quiero que mi carrito y mi lista de favoritos sigan funcionando y sigan apuntando al producto correcto, para no perder lo que ya tenía guardado.
- HU-4. Como administrador, quiero entrar al panel con mi correo y mi contraseña gestionados por el servicio de identidad, para que la contraseña no viva dentro del código público y nadie más pueda entrar.
- HU-5. Como administrador, quiero crear, editar, retirar y volver a publicar productos, ver su estado y que el cambio quede guardado en la base de datos, para no depender de descargar un fichero y subirlo a mano.
- HU-6. Como administrador, quiero saber si cada cambio se guardó o falló, y no perder lo que estaba escribiendo si la sesión caduca, para no repetir trabajo.
- HU-7. Como administrador, quiero que el panel se cierre solo cuando la sesión caduca, para no dejar el panel abierto en un equipo compartido.

## Definiciones

- **Catálogo vigente**: el conjunto de productos que la tienda muestra a sus visitantes, con su nombre, categoría, precio, precio anterior, valoración, número de reseñas, imagen, descripción y especificaciones. En esta fase es el que publica la base de datos; el catálogo maestro del repositorio es su copia de respaldo. Hoy son 75 productos con identificadores del 1 al 75 y versión 26.
- **Identificador de producto**: la referencia estable de cada producto, usada por el carrito, la lista de favoritos y las acciones del panel. Es el número que cada producto tiene hoy, y ese mismo número se conserva como clave primaria en la base de datos.
- **Moneda base del catálogo**: los pesos Cubanos (CUP). Todos los precios se almacenan e interpretan en CUP.
- **Equivalente en USD**: el valor en dólares derivado del precio en CUP con la tasa fija de 400 CUP = 1 USD, redondeado a dos decimales. Es informativo y nunca sustituye al precio en CUP.
- **Existencias (stock)**: el número de unidades disponibles de un producto. Solo admite un entero mayor o igual que cero, o bien ningún valor, que significa que no hay control de existencias.
- **Producto activo**: el que la tienda ofrece al público, con estado activo. Un visitante anónimo ve únicamente los productos activos.
- **Producto agotado**: un producto activo con existencias iguales a cero. Se muestra al público identificado como agotado y no se puede añadir al carrito.
- **Producto retirado**: un producto que ya no se ofrece al público. El visitante no lo ve y su registro se conserva en la base de datos.
- **Rol de administrador**: la marca `admin` guardada en los metadatos internos de la cuenta (no editables por el usuario), cuya comprobación aplica el servidor.
- **Sesión de administrador**: el estado autenticado y autorizado de una cuenta concreta dentro del navegador.
- **Sesión caducada**: el estado en que el acceso de la sesión ha vencido y no puede renovarse. El panel se bloquea, avisa de lo que no ha quedado guardado y se cierra.
- **Copia local del catálogo**: la versión del catálogo que el navegador guarda en su almacenamiento local, con su número de versión, usada como respaldo mientras la base de datos no responde. Se guarda con el formato vigente —marca de formato, versión y array de productos con los nombres de campo de cliente— y se valida antes de usarla. No tiene prioridad sobre lo publicado: en cuanto la base de datos responde, se reemplaza por la versión publicada.
- **Versión del catálogo**: el número de revisión del catálogo, único para toda la cadena (carga inicial en la base de datos, copia local del navegador y exportación). La carga inicial lo hereda del catálogo maestro vigente (26) y solo avanza cuando el contenido del catálogo cambia de verdad.
- **Clave publicable**: la clave de solo lectura del servicio, pública por diseño, que el sitio publicado incrusta para leer el catálogo. No es un secreto y no permite escribir, porque lo impiden las políticas de acceso del servidor.
- **Servicio de identidad**: el proveedor de autenticación que valida credenciales y emite sesiones.
- **Carga inicial**: la operación única, anterior al uso del sitio, que traslada el catálogo vigente del repositorio a la base de datos y al bucket de imágenes.

## Requisitos funcionales

### A. Carga inicial y linaje del catálogo

- RF-1. CUANDO se realiza la carga inicial del catálogo en la base de datos —una única vez, sobre el proyecto ya existente—, EL SISTEMA inserta o actualiza un registro por cada uno de los 75 productos del catálogo vigente, conservando su identificador numérico, y sube al bucket de archivos las imágenes que ese catálogo usa, de modo que el número de productos almacenados coincide con el número de productos del catálogo vigente.
- RF-2. CUANDO un producto del catálogo vigente pasa a residir en la base de datos, EL SISTEMA conserva su identificador numérico actual como clave primaria del registro, de forma que un carrito o una lista de favoritos guardados por un visitante sigan apuntando a ese mismo producto.
- RF-3. CUANDO el administrador crea un producto nuevo, EL SISTEMA le asigna el identificador en el servidor —nunca en el cliente—, de modo que nunca haya colisiones y nunca se reutilice el identificador de un producto retirado.
- RF-4. CUANDO la carga inicial se repite, EL SISTEMA la aplica de forma idempotente por identificador: inserta o actualiza cada producto del catálogo vigente y nunca borra ni sobrescribe un registro que solo existe en la base de datos, de manera que ninguna reiteración pueda perder lo que el administrador haya creado o editado desde el panel.
- RF-5. EL SISTEMA solo borra de forma masiva el contenido de la base de datos ante una acción explícita y destructiva, con su aviso correspondiente, y esa acción no forma parte del flujo normal de trabajo.
- RF-6. EL SISTEMA mantiene una única versión del catálogo, compartida por toda la cadena (carga inicial en la base de datos, copia local del navegador y exportación): la carga inicial la hereda del catálogo maestro vigente (26) y solo avanza cuando el contenido del catálogo cambia de verdad, no por el mero hecho de exportar.

### B. Gestión del catálogo desde el panel

- RF-7. CUANDO el administrador guarda un producto nuevo o la edición de uno existente, EL SISTEMA persiste el cambio en la base de datos y confirma la operación mostrando los valores que quedaron guardados.
- RF-8. CUANDO el administrador elimina un producto, EL SISTEMA lo retira del catálogo público conservando su registro en la base de datos, lo quita de los carritos y listas de favoritos guardados en el navegador del administrador y le informa de que la baja queda conservada en la base de datos.
- RF-9. CUANDO el administrador retira un producto, lo vuelve a publicar o informa sus existencias, EL SISTEMA refleja el cambio en el catálogo público en la siguiente carga, sin necesidad de redesplegar el sitio; y el formulario del panel dispone del control para cambiar ese estado.
- RF-10. CUANDO el administrador informa las existencias de un producto, EL SISTEMA solo admite un entero mayor o igual que cero, o bien ningún valor —que significa que no hay control de existencias—; y el formulario del panel dispone de un campo para informarlas.
- RF-11. CUANDO se guarda o se muestra un precio, EL SISTEMA lo interpreta en pesos Cubanos (CUP), lo almacena en CUP junto con su equivalente en dólares calculado con la tasa fija de 400 CUP = 1 USD, y lo presenta al visitante en CUP con su equivalente en USD en todos los lugares donde se muestra el precio —tarjeta de producto, carrito, totales, ficha ampliada y mensaje de WhatsApp—; y las etiquetas del formulario del panel rotulan los campos de precio como CUP, no como dólares.
- RF-12. CUANDO el administrador adjunta una imagen a un producto, EL SISTEMA la sube al bucket `product-images` y guarda en el registro la URL de esa imagen, que es siempre una URL del bucket: nunca una ruta local ni una URL externa. El campo de imagen del panel deja de ser un texto libre. La imagen por defecto del producto sin imagen reside también en el bucket, de modo que el catálogo publicado no depende de la carpeta de imágenes del repositorio.
- RF-13. EL bucket `product-images` es de lectura pública, para que las imágenes del catálogo carguen en la tienda, y solo una sesión con el rol `admin` puede escribir en él.
- RF-14. SI el administrador intenta guardar un producto sin nombre, sin categoría, o con un precio que no sea un número no negativo, ENTONCES EL SISTEMA rechaza el guardado, explica el motivo y deja intacto el registro anterior.
- RF-15. CUANDO un producto lleva la etiqueta de oferta pero no tiene precio anterior, EL SISTEMA no muestra esa etiqueta, porque no es una oferta real.
- RF-16. CUANDO el precio anterior de un producto no es mayor que su precio actual, EL SISTEMA no lo muestra tachado.
- RF-17. CUANDO el administrador pulsa «Guardar» más de una vez sobre el mismo producto, EL SISTEMA lo guarda una sola vez.
- RF-18. CUANDO dos paneles abiertos modifican el mismo producto, EL SISTEMA da por bueno el cambio más reciente y avisa al administrador de que el registro había cambiado.
- RF-19. CUANDO el administrador guarda un cambio, EL SISTEMA registra qué cuenta lo realizó y en qué momento.
- RF-20. CUANDO el administrador importa un catálogo desde un archivo, EL SISTEMA acepta tanto el objeto maestro como el array de productos, aplica el contenido sobre la base de datos —que es la fuente de verdad de lo que ve la web— e informa de cuántos productos se añadieron, actualizaron y retiraron; los productos retirados se dan de baja lógicamente, conservando su registro, y esa retirada exige confirmación previa; y un archivo mal formado o con campos inválidos se rechaza con un mensaje claro sin tocar la base de datos.
- RF-21. CUANDO el administrador exporta el catálogo, EL SISTEMA produce un archivo con el formato del catálogo maestro vigente y con el contenido que hay en la base de datos, para usarlo como copia de respaldo o para regenerar el catálogo maestro del repositorio; y la exportación no es un paso obligatorio para publicar, porque el catálogo que muestra la web es el de la base de datos.
- RF-22. EL SISTEMA no ofrece en el panel ninguna acción que reponga el catálogo maestro estático del repositorio sobre el catálogo publicado: el botón «Restaurar original» deja de existir, porque podría pisar sin querer todo lo que el administrador haya creado desde el panel; y la restauración de un catálogo corrompido se hace desde la exportación de respaldo.
- RF-23. CUANDO una escritura en la base de datos falla —por una caída de la red o porque la sesión ha caducado—, EL SISTEMA avisa del fallo, no da el cambio por guardado y conserva lo que el administrador había escrito para que pueda intentarlo de nuevo.

### C. Acceso al panel

- RF-24. CUANDO el administrador introduce su correo y su contraseña en la pantalla de acceso, EL SISTEMA los verifica contra el servicio de identidad y abre el panel solo si la cuenta existe y está habilitada.
- RF-25. SI el correo o la contraseña no son correctos, o la cuenta está deshabilitada, ENTONCES EL SISTEMA no abre el panel, muestra un mensaje de error genérico que no revela si la cuenta existe, y no guarda ni registra la credencial introducida.
- RF-26. CUANDO una cuenta autenticada no tiene el rol `admin` en sus metadatos internos, EL SISTEMA le impide abrir el panel y el servidor rechaza cualquier intento de escritura sobre el catálogo; la comprobación del rol la aplica el servidor, no el cliente, y no puede apoyarse en el origen de la petición.
- RF-27. EL SISTEMA admite varias cuentas con el rol de administrador y todas ellas pueden gestionar el catálogo; las cuentas se dan de alta fuera de la tienda, con la credencial privilegiada, y quedan ya habilitadas para entrar.
- RF-28. EL SISTEMA crea la cuenta de administrador con una contraseña distinta de la que hoy está publicada —cuyo hash SHA-256 vive en un repositorio público— y esa credencial no se escribe en el repositorio.
- RF-29. CUANDO caduca la sesión del administrador, EL SISTEMA intenta renovar el acceso de forma silenciosa; y SI la renovación no es posible, ENTONCES bloquea el panel, conserva lo que el administrador había escrito en el formulario, le avisa de lo que no ha quedado guardado y cierra la sesión.
- RF-30. CUANDO el administrador abre el panel, EL SISTEMA le muestra el catálogo que hay en la base de datos, listando tanto los productos activos como los retirados con su estado visible, y solo ofrece al público los activos.
- RF-31. EL SISTEMA corrige los textos del panel que aún indican el flujo antiguo —la pista que pide descargar el fichero y reemplazar el archivo del repositorio, y el aviso que aparece tras cada cambio— para que no contradigan que la base de datos es la fuente de verdad de lo que ve la web.
- RF-32. EL SISTEMA no publica en el repositorio ninguna credencial con permisos de escritura ni ningún secreto de servicio; en particular, desaparecen del código publicado el hash de la contraseña del panel y su función de respaldo. La clave publicable de solo lectura sí está en el código publicado: es pública por diseño, no es un secreto y no permite escribir porque lo impiden las políticas de acceso del servidor.

### D. Catálogo público, respaldo y degradación

- RF-33. CUANDO un visitante carga la tienda y la base de datos responde dentro del tiempo de espera, EL SISTEMA muestra el catálogo publicado en la base de datos, con independencia de que exista en el navegador una copia local con una versión distinta.
- RF-34. EL SISTEMA ofrece al público únicamente los productos activos; y CUANDO un producto tiene existencias iguales a cero, EL SISTEMA lo muestra visible e identificado como agotado, impide que se añada al carrito y mantiene el resto de su ficha (imagen, precio, descripción y especificaciones) intacta.
- RF-35. SI la base de datos no responde o agota el tiempo de espera, ENTONCES EL SISTEMA muestra el último catálogo conocido en ese navegador (o la semilla incluida en el sitio), avisa de que la información puede no estar actualizada y, en ningún caso, deja la tienda en blanco.
- RF-36. CUANDO la base de datos no responde, EL SISTEMA muestra un aviso único en pantalla, que el visitante puede cerrar y que no reaparece en cada reintento; guarda en el navegador el catálogo que ha leído de la base de datos como respaldo, y reintenta la lectura automáticamente cada 15 segundos, rearmando el reintento en cada fallo, hasta que la base de datos vuelva a responder.
- RF-37. MIENTRAS la tienda esté abierta, EL SISTEMA no borra ni sobrescribe los datos guardados en el navegador del visitante (carrito, favoritos, tema y copia local del catálogo) a consecuencia de un fallo de la base de datos.
- RF-38. CUANDO la base de datos no ha respondido, EL SISTEMA conserva la copia local del catálogo sin sobrescribirla; y CUANDO la base de datos responde, EL SISTEMA reemplaza la copia local por la versión publicada, que queda como respaldo fresco. La copia local deja de competir con lo publicado: aunque tenga una versión mayor —que solo puede proceder de cambios del panel antiguo que nunca se publicaron—, la web muestra siempre lo publicado y la copia local se descarta.
- RF-39. EL SISTEMA guarda la copia local del catálogo con el formato vigente —un objeto con la marca de formato, la versión y el array de productos, con los nombres de campo de cliente— y la valida antes de usarla, de modo que no se descarte como inválida por un cambio de formato.
- RF-40. EL SISTEMA conserva el formato de cliente de las instantáneas de carrito y de favoritos ya guardadas en los navegadores —con los nombres de campo actuales, incluido el precio y el precio anterior— de modo que sigan leyéndose y apuntando al producto correcto; la traducción entre el formato de la base de datos y el de cliente ocurre en el borde de lectura, sin reescribir lo ya guardado.
- RF-41. CUANDO el carrito o la lista de favoritos de un visitante contiene un producto que ya no existe en el catálogo, EL SISTEMA lo omite al mostrar esos listados.
- RF-42. SI el navegador no tiene espacio de almacenamiento para la copia local del catálogo, ENTONCES EL SISTEMA sigue funcionando con el catálogo de la base de datos y no interrumpe la experiencia del visitante.

## Requisitos no funcionales

- RNF-1. El sitio sigue siendo un sitio estático publicado en GitHub Pages: sin servidor propio, sin empaquetador y sin paso de compilación del sitio —el único comando de construcción valida el catálogo maestro y regenera la semilla—, y sin dependencias de npm. El acceso al servicio se hace con el cliente oficial del servicio cargado por CDN ESM, sin que eso suponga un paso de compilación ni un empaquetador.
- RNF-2. El sitio funciona servido por HTTP y también abierto como archivo local: en ambos casos el visitante ve un catálogo. La carga inicial incluye regenerar la semilla del sitio a partir del catálogo maestro, de modo que el respaldo local contenga el mismo número de productos que el catálogo migrado.
- RNF-3. Ninguna escritura en la base de datos ni en el bucket de archivos es posible sin una sesión con el rol de administrador; un visitante anónimo solo puede leer lo publicado, y la comprobación la aplica el servidor, no el cliente.
- RNF-4. Toda lectura remota se corta a los 12 segundos como máximo en cada intento, la cadencia de reintento es de 15 segundos y el reintento se rearma en cada fallo; la interfaz nunca queda esperando indefinidamente.
- RNF-5. Los datos que la tienda expone al público no incluyen información interna —como la cuenta que editó el producto o marcas de tiempo de auditoría— ni el registro de los productos retirados.
- RNF-6. El catálogo completo, incluidas sus imágenes, cabe en los límites del plan gratuito del servicio de base de datos.
- RNF-7. Las credenciales privilegiadas —la clave secreta del servicio— viven solo en el entorno local ignorado por git y nunca se versionan ni aparecen en la documentación.
- RNF-8. La interfaz y la documentación están en español; el código y los identificadores en inglés.
- RNF-9. La tienda y el panel siguen siendo utilizables en una pantalla de 375 px de ancho.
- RNF-10. La carga inicial del catálogo es idempotente y puede ejecutarse más de una vez sin duplicar productos, sin perder registros y sin dejar basura.
- RNF-11. La tasa de conversión entre CUP y USD (400 CUP = 1 USD) es un valor único, fijo y compartido por la carga inicial, la base de datos y la tienda, de modo que el catálogo, la base de datos y lo que ve el visitante no puedan contradecirse.
- RNF-12. El orden de publicación es obligatorio: las políticas de acceso de la tabla y del bucket existen y están comprobadas antes de que la clave publicable se incruste en el código publicado; si no, cualquier visitante podría escribir.
- RNF-13. La comprobación de que una cuenta sin el rol `admin` no puede escribir se realiza con una cuenta de prueba creada con la credencial privilegiada, fuera del repositorio, que se elimina al terminar la comprobación.
- RNF-14. El cliente del servicio se carga desde CDN, sin paso de compilación ni empaquetador, y en una versión fijada de forma explícita —no «la última»—, para que el sitio no dependa de un cambio no controlado en el proveedor ni se rompa sin que nadie lo haya tocado.

## Casos límite

- El servicio de base de datos está lento o caído justo al abrir la tienda: se muestra el catálogo de respaldo, se avisa una sola vez y la tienda nunca queda en blanco. (RF-35, RF-36)
- Con la base de datos caída se acumulan reintentos: el aviso no se repite, el visitante puede cerrarlo y la tienda se recupera sola cuando la base de datos vuelve a responder. (RF-36)
- La sesión del administrador caduca mientras rellena el formulario de producto: se le avisa de que la sesión expiró y se conservan los datos que había escrito. (RF-23, RF-29)
- Un producto se queda sin imagen, o la imagen no se pudo subir: la tienda muestra la imagen por defecto, que reside también en el bucket. (RF-12)
- Precio 0 (producto gratuito o promoción): se guarda y se muestra como 0, nunca como campo vacío ni como «sin precio». (RF-14)
- Precio anterior menor o igual que el precio actual: no se muestra tachado. (RF-16)
- Etiqueta de oferta sin precio anterior: la etiqueta no se muestra. (RF-15)
- Un producto con existencias nulas (sin control de existencias): se muestra disponible, sin marca de agotado. (RF-10, RF-34)
- Un producto que pasa a estar agotado después de estar en el carrito de alguien: se conserva en el carrito y se marca como agotado, sin que se rompa el resto de la ficha ni el resto del proceso de compra. (RF-34, RF-40)
- El equivalente en dólares de un precio en CUP se redondea a dos decimales (por ejemplo, 1 500 CUP equivalen a 3,75 USD). (RF-11, RNF-11)
- El administrador pulsa «Guardar» dos veces seguidas: el producto se guarda una sola vez. (RF-17)
- Dos paneles abiertos sobre el mismo producto: el cambio más reciente manda y el administrador ve el aviso de que el registro había cambiado. (RF-18)
- Un producto desaparece del catálogo mientras un visitante lo tiene en el carrito o en favoritos: se omite al mostrar esos listados. (RF-41)
- La copia local del navegador tiene una versión distinta de la publicada, por ejemplo por cambios hechos en el panel antiguo que nunca se publicaron: se conserva intacta mientras la base de datos no haya respondido y, en cuanto esta responde, se reemplaza por la versión publicada, sin que se pierda nada que ya estuviera publicado. (RF-33, RF-38)
- La carga inicial del catálogo se reejecuta: no duplica productos y no borra lo que el administrador ha creado desde el panel. (RF-4, RF-5, RNF-10)
- El archivo de catálogo importado está mal formado o trae campos inválidos: se rechaza con un mensaje claro y la base de datos queda como estaba. (RF-20)
- El catálogo publicado se corrompe: el panel no ofrece ninguna vía para reponerlo desde la copia estática del repositorio; el administrador recupera el estado anterior desde su exportación de respaldo. (RF-21, RF-22)
- El navegador no tiene espacio de almacenamiento para la copia local del catálogo: la tienda sigue funcionando con el catálogo de la base de datos. (RF-42)
- Varias cuentas de administrador: cada una entra y gestiona el catálogo, y ninguna puede concederse ese rol a sí misma desde la tienda. (RF-26, RF-27)
- Un visitante abre el sitio como archivo local: la protección no depende del origen de la petición, así que sigue sin poder escribir en el catálogo. (RF-26, RF-32)

## Fuera de alcance

- Nuevas funcionalidades de la tienda (pedidos, pagos, cuentas de cliente, cupones, envío): van en specs posteriores.
- Crear, editar o eliminar cuentas de administrador desde la interfaz del panel: el panel gestiona el catálogo, no los usuarios; las cuentas se dan de alta fuera de la tienda.
- La regeneración automática del catálogo maestro del repositorio: la exportación de respaldo es una acción manual del administrador.
- Restablecer el catálogo publicado desde la copia estática del repositorio dentro del panel: esa vía se elimina y no se sustituye por ninguna otra acción de restauración; la recuperación se hace fuera de la tienda, con la exportación de respaldo.
- Restablecimiento de contraseña por correo: las cuentas de administrador se crean ya confirmadas y, si se pierde la credencial, se recrea con la credencial privilegiada.
- Envío de correos transaccionales desde la propia aplicación, que además requeriría configurar un servicio de correo.
- Control de existencias como funcionalidad completa: la columna de existencias se guarda hoy, pero su control automático y su integración con el pedido quedan para specs posteriores.
- Copias de seguridad automáticas, réplicas o despliegue multi-región.
- Migrar el sitio a un framework, a un empaquetador o a dependencias npm.
- Aplicación móvil nativa.
- Analítica de visitas o de ventas.
- Rediseño visual de la tienda o del panel: esta spec cambia de dónde vienen los datos, no cómo se ven.
- Sustituir el servicio de base de datos actual por otro.

## Criterios de finalización

1. La base de datos contiene el catálogo vigente completo: el mismo número de productos (75) y, para cada uno, el mismo identificador numérico, nombre, categoría, precio, precio anterior, valoración, reseñas, descripción y especificaciones; la imagen es la URL del bucket equivalente a la del maestro, la etiqueta de oferta sin precio anterior ha quedado limpia, las existencias se han inicializado sin control de existencias y todos los productos quedan activos. (RF-1, RF-2, RF-15)
2. La tienda muestra cada precio en CUP con su equivalente en USD a 400 CUP = 1 USD, en la tarjeta, el carrito, los totales, la ficha ampliada y el mensaje de WhatsApp, y el formulario del panel rotula los campos de precio como CUP. (RF-11)
3. El acceso al panel con la cuenta de administrador abre el panel; con credenciales incorrectas no, y el mensaje de error no revela si la cuenta existe. (RF-24, RF-25)
4. El repositorio no contiene ninguna credencial con permisos de escritura ni secreto de servicio: el hash de contraseña del panel y su función de respaldo han desaparecido, y la clave publicable de solo lectura que el sitio publica no permite escribir, porque el servidor lo rechaza. (RF-32, RNF-3)
5. Una cuenta autenticada sin el rol `admin` no puede escribir ni en el catálogo ni en el bucket de imágenes, comprobado sobre la base de datos con una cuenta de prueba creada fuera del repositorio y eliminada al terminar. (RF-13, RF-26, RNF-13)
6. Un alta, una edición y una baja hechas desde el panel se ven reflejadas en la base de datos y no solo en el navegador del administrador. (RF-7, RF-8)
7. Con la base de datos caída, la tienda sigue mostrando un catálogo con un aviso único; y al restaurarla, el catálogo se actualiza sin recargar la página en 15 segundos o menos. (RF-35, RF-36)
8. Un producto con existencias iguales a cero se muestra identificado como agotado y no se puede añadir al carrito, sin romper el resto de su ficha. (RF-34)
9. Todas las imágenes del catálogo se sirven desde el bucket `product-images`, incluida la imagen por defecto, y ninguna referencia guardada apunta a la carpeta de imágenes del repositorio. (RF-12)
10. El bucket `product-images` es de lectura pública y rechaza cualquier escritura que no venga de una sesión con el rol `admin`. (RF-13)
11. El botón «Descargar products.json» sigue disponible y produce un catálogo equivalente al de la base de datos, sin ser un paso obligatorio para publicar. (RF-21)
12. El panel ya no ofrece el botón «Restaurar original» ni ninguna otra acción que reponga el catálogo maestro estático del repositorio sobre el catálogo publicado. (RF-22)
13. El panel lista los productos activos y los retirados con su estado visible, y solo los activos se ofrecen al público. (RF-30, RF-34)
14. El carrito y la lista de favoritos ya guardados en un navegador siguen leyéndose con su formato actual y siguen apuntando al producto correcto tras el cambio. (RF-40)
15. La carga inicial puede repetirse sin duplicar productos y sin borrar lo que el administrador ha creado desde el panel; el borrado masivo solo ocurre ante una acción explícita y destructiva con su aviso. (RF-4, RF-5, RNF-10)
16. La verificación del proyecto (`npm run build`) sigue en verde, la base de datos no tiene avisos críticos de seguridad y la semilla regenerada contiene el mismo número de productos que el catálogo migrado. (RNF-2)
17. La tienda y el panel son usables a 375 px de ancho. (RNF-9)
18. El sitio se despliega y funciona como sitio estático, sin paso de compilación ni empaquetador, con el cliente del servicio cargado desde CDN en una versión fijada de forma explícita. (RNF-1, RNF-14)

## Dudas abiertas

Ninguna. La única cuestión que quedaba pendiente (D-1, el choque entre la constitución y la regla de la copia local del navegador) quedó **resuelta por decisión del usuario: se enmienda el principio 5 de la constitución**, de modo que la base de datos es la fuente de verdad de lo que ve la web y la copia local del navegador se conserva sin sobrescribir mientras la base de datos no responde, pero se reemplaza por la versión publicada cuando esta responde. Esa enmienda ya está incorporada a esta spec (RF-33, RF-38) y no se reabre.

Decidido en esta revisión de calidad, sin reabrir ninguna de las dudas anteriores: la carga inicial es única e idempotente por identificador; el borrado masivo solo existe detrás de una acción explícita y destructiva; los identificadores de los productos nuevos se asignan en el servidor y no se reutiliza el de un producto retirado; el bucket es de lectura pública y de escritura exclusiva del rol `admin`; la clave publicable es pública por diseño y no habilita escrituras; el panel lista activos y retirados con su estado visible; los textos del panel dejan de indicar el flujo de descarga y push; la importación acepta el objeto maestro y el array, y los productos retirados son bajas lógicas con confirmación previa; el fallo de escritura avisa, no da el cambio por guardado y conserva lo escrito; el formato de la copia local y el de las instantáneas de carrito y favoritos se conservan; la versión del catálogo es un único número heredado del maestro (26) que solo avanza si el contenido cambia; el aviso de caída es único, cerrable y no reaparece en cada reintento; los reintentos son cada 15 segundos y se rearman en cada fallo; la verificación del rol se hace con una cuenta de prueba temporal fuera del repositorio; y las políticas de acceso de la tabla y del bucket se comprueban antes de publicar la clave publicable.

Y por decisión del usuario, en esta misma revisión: el sitio accede al servicio con el cliente oficial cargado por CDN ESM, sin paso de compilación ni empaquetador, en una versión fijada de forma explícita.
