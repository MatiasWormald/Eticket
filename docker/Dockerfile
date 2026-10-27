FROM php:8.5-apache@sha256:5fec3fb1f0322c20a01c8af35a09a96f3a83aa369650b0fed161e91cb84056ed

ARG GLPI_TARBALL=glpi-12.0.0.tgz
ARG GLPI_SHA256=90c81d1742f5e345756089a83e7c72848bbcae130ea449c8d32f52ad63dece91

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libcurl4-openssl-dev \
        libfreetype6-dev \
        libicu-dev \
        libjpeg62-turbo-dev \
        libldap2-dev \
        libpng-dev \
        libzip-dev \
    && rm -rf /var/lib/apt/lists/*

RUN docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-configure ldap --with-libdir=lib/x86_64-linux-gnu \
    && docker-php-ext-install -j"$(nproc)" \
        bcmath \
        exif \
        gd \
        intl \
        ldap \
        mysqli \
        pdo_mysql \
        zip

RUN a2enmod rewrite headers expires \
    && a2dissite 000-default.conf

COPY docker/apache-glpi.conf /etc/apache2/sites-available/glpi.conf
COPY docker/php-glpi.ini /usr/local/etc/php/conf.d/zz-glpi.ini

RUN a2ensite glpi.conf

WORKDIR /var/www/html

COPY ${GLPI_TARBALL} /tmp/glpi.tgz
RUN echo "${GLPI_SHA256}  /tmp/glpi.tgz" | sha256sum -c - \
    && tar -xzf /tmp/glpi.tgz -C /var/www/html --strip-components=1 \
    && rm /tmp/glpi.tgz \
    && mkdir -p config files marketplace \
    && chown -R www-data:www-data /var/www/html

COPY docker/entrypoint.sh /usr/local/bin/glpi-entrypoint
COPY docker/configure-glpi.php /usr/local/bin/configure-glpi.php
COPY docker/provision-hub.php /usr/local/bin/provision-hub.php
COPY docker/check-hub.php /usr/local/bin/check-hub.php
COPY docker/test-hub.php /usr/local/bin/test-hub.php
COPY config/hub.json /usr/local/share/eticket/hub.json

RUN sed -i 's/\r$//' /usr/local/bin/glpi-entrypoint \
    && chmod +x /usr/local/bin/glpi-entrypoint

ENTRYPOINT ["glpi-entrypoint"]
CMD ["apache2-foreground"]
