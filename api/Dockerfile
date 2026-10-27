FROM php:8.5-apache

RUN a2enmod rewrite headers

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY api/php.ini /usr/local/etc/php/conf.d/zz-api.ini
COPY api/apache.conf /etc/apache2/sites-available/api.conf

RUN a2dissite 000-default.conf && a2ensite api.conf

WORKDIR /var/www/html

COPY api/public /var/www/html/public
COPY api/src /var/www/html/src

EXPOSE 80
CMD ["apache2-foreground"]
